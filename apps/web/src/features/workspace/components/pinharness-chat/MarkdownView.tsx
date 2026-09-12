/**
 * MarkdownView — PinHarness Markdown surface, copied into the AgentHub chat
 * boundary. The transport adapter stays outside this component; headings,
 * paragraphs, lists, code, tables and links intentionally use the source
 * renderer's spacing and palette instead of browser-default markdown.
 */

import { Check, Copy } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
  isValidElement,
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { StreamingDots } from './StreamingDots';

const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const MAX_MARKDOWN_RENDER_CHARS = 512 * 1024;

function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return '';
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const fallback = document.createElement('textarea');
    fallback.value = value;
    fallback.setAttribute('readonly', 'true');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand('copy');
    fallback.remove();
    return copied;
  } catch {
    return false;
  }
}

function CodeBlock({
  language,
  children,
  streaming = false,
}: {
  language: string | null;
  children: ReactNode;
  streaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const codeText = extractText(children);
  const handleCopy = useCallback(async () => {
    if (!(await copyText(codeText))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_400);
  }, [codeText]);

  return (
    <div
      className="pinharness-markdown-code"
      style={{
        position: 'relative',
        margin: '10px 0',
        overflow: 'hidden',
        borderRadius: '7px',
        border: '1px solid hsl(var(--border))',
        backgroundColor: 'hsl(var(--surface-muted))',
      }}
      data-streaming={streaming || undefined}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid hsl(var(--border))',
          backgroundColor: 'hsl(var(--surface-hover))',
          padding: '6px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: 'hsl(var(--foreground-faint))',
              display: 'inline-block',
            }}
          />
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'hsl(var(--foreground-subtle))',
            }}
          >
            {language ?? 'code'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[hsl(var(--foreground-subtle))] transition-[background-color,color,transform] duration-150 hover:bg-[hsl(var(--surface-muted))]/80 active:scale-90"
          title="复制代码"
          aria-label={copied ? '已复制代码' : '复制代码'}
        >
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre
        style={{
          overflowX: 'auto',
          padding: language ? '12px 14px' : '10px 12px',
          fontSize: '12px',
          lineHeight: 1.65,
          color: 'hsl(var(--foreground))',
          margin: 0,
          fontFamily: FONT_MONO,
        }}
      >
        <code>
          <span>{codeText}</span>
          {streaming && <span className="streaming-type-caret" aria-hidden="true" />}
        </code>
      </pre>
    </div>
  );
}

function resolveLanguage(children: ReactNode): string | null {
  if (!isValidElement<{ className?: string }>(children)) return null;
  const className = children.props.className;
  const match = typeof className === 'string' ? className.match(/language-([\w-]+)/) : null;
  return match?.[1] ?? null;
}

function normalizeMarkdown(value: string): {
  text: string;
  truncated: boolean;
  originalLength: number;
} {
  const originalLength = value.length;
  if (originalLength <= MAX_MARKDOWN_RENDER_CHARS) {
    return { text: value, truncated: false, originalLength };
  }
  return {
    text: value.slice(0, MAX_MARKDOWN_RENDER_CHARS),
    truncated: true,
    originalLength,
  };
}

export interface MarkdownViewProps {
  text: string;
  streaming?: boolean;
  size?: 'default' | 'large';
  className?: string;
}

export const MarkdownView = memo(function MarkdownView({
  text,
  streaming = false,
  size = 'default',
  className,
}: MarkdownViewProps) {
  const prepared = useMemo(() => normalizeMarkdown(text), [text]);
  const fontSize = size === 'large' ? '14px' : '13px';
  const lineHeight = size === 'large' ? 1.75 : 1.7;
  const rootStyle: CSSProperties = {
    fontSize,
    lineHeight,
    wordBreak: 'break-word',
    color: 'hsl(var(--foreground))',
  };

  return (
    <div
      className={`markdown-body min-w-0 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_li>p]:my-0 [&_li>ul]:my-1 [&_li>ol]:my-1 [&_ul_ul]:list-[circle] [&_ul_ul_ul]:list-[square] [&_ol_ol]:list-[lower-alpha] ${className ?? ''}`}
      style={rootStyle}
    >
      {prepared.truncated && (
        <div
          role="status"
          style={{
            marginBottom: '8px',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
            padding: '6px 9px',
            color: 'hsl(var(--foreground-muted))',
            backgroundColor: 'hsl(var(--surface-muted))',
            fontSize: '11px',
          }}
        >
          内容共 {prepared.originalLength.toLocaleString()} 字符，富文本预览仅展示前{' '}
          {MAX_MARKDOWN_RENDER_CHARS.toLocaleString()} 字符；原文未被修改。
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ className: c, children, ...rest }) => (
            <h1
              {...rest}
              className={c}
              style={{
                marginTop: '22px',
                marginBottom: '10px',
                paddingBottom: '7px',
                borderBottom: '1px solid hsl(var(--border))',
                fontSize: '1.42em',
                lineHeight: 1.3,
                fontWeight: 650,
                letterSpacing: '-0.018em',
                color: 'hsl(var(--foreground))',
              }}
            >
              {children}
            </h1>
          ),
          h2: ({ className: c, children, ...rest }) => (
            <h2
              {...rest}
              className={c}
              style={{
                marginTop: '18px',
                marginBottom: '8px',
                fontSize: '1.24em',
                lineHeight: 1.35,
                fontWeight: 650,
                letterSpacing: '-0.012em',
                color: 'hsl(var(--foreground))',
              }}
            >
              {children}
            </h2>
          ),
          h3: ({ className: c, children, ...rest }) => (
            <h3
              {...rest}
              className={c}
              style={{
                marginTop: '15px',
                marginBottom: '6px',
                fontSize: '1.1em',
                lineHeight: 1.4,
                fontWeight: 650,
                color: 'hsl(var(--foreground))',
              }}
            >
              {children}
            </h3>
          ),
          h4: ({ className: c, children, ...rest }) => (
            <h4
              {...rest}
              className={c}
              style={{
                marginTop: '13px',
                marginBottom: '4px',
                fontSize: '1em',
                lineHeight: 1.45,
                fontWeight: 650,
                color: 'hsl(var(--foreground))',
              }}
            >
              {children}
            </h4>
          ),
          p: ({ className: c, children, ...rest }) => (
            <p
              {...rest}
              className={c}
              style={{ margin: '6px 0', color: 'hsl(var(--foreground-muted))' }}
            >
              {children}
            </p>
          ),
          blockquote: ({ className: c, children, ...rest }) => (
            <blockquote
              {...rest}
              className={c}
              style={{
                margin: '10px 0',
                borderRadius: '0 6px 6px 0',
                backgroundColor: 'hsl(var(--surface-muted) / 0.5)',
                padding: '8px 12px',
                color: 'hsl(var(--foreground-muted))',
                border: '1px solid hsl(var(--border))',
              }}
            >
              {children}
            </blockquote>
          ),
          hr: ({ className: c, ...rest }) => (
            <hr
              {...rest}
              className={c}
              style={{
                margin: '16px 0',
                border: 'none',
                height: '1px',
                backgroundColor: 'hsl(var(--border))',
              }}
            />
          ),
          ul: ({ className: c, ...rest }) => (
            <ul
              {...rest}
              className={c}
              style={{ margin: '8px 0', paddingLeft: '24px', listStyleType: 'disc' }}
            />
          ),
          ol: ({ className: c, ...rest }) => (
            <ol
              {...rest}
              className={c}
              style={{ margin: '8px 0', paddingLeft: '24px', listStyleType: 'decimal' }}
            />
          ),
          li: ({ className: c, children, ...rest }) => (
            <li
              {...rest}
              className={c}
              style={{
                lineHeight: 1.65,
                color: 'hsl(var(--foreground-muted))',
                paddingLeft: '2px',
                marginBottom: '5px',
              }}
            >
              {children}
            </li>
          ),
          a: ({ className: c, children, ...rest }) => (
            <a
              {...rest}
              className={c}
              target="_blank"
              rel="noreferrer noopener"
              style={{
                fontWeight: 500,
                color: 'hsl(var(--primary))',
                textDecoration: 'underline',
                textDecorationColor: 'hsl(var(--primary) / 0.4)',
                textUnderlineOffset: '3px',
              }}
            >
              {children}
            </a>
          ),
          strong: ({ className: c, children, ...rest }) => (
            <strong
              {...rest}
              className={c}
              style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}
            >
              {children}
            </strong>
          ),
          em: ({ className: c, children, ...rest }) => (
            <em
              {...rest}
              className={c}
              style={{ fontStyle: 'italic', color: 'hsl(var(--foreground-muted))' }}
            >
              {children}
            </em>
          ),
          del: ({ className: c, children, ...rest }) => (
            <del {...rest} className={c} style={{ color: 'hsl(var(--foreground-faint))' }}>
              {children}
            </del>
          ),
          code: ({ className: c, children, ...rest }: ComponentPropsWithoutRef<'code'>) => {
            const codeText = extractText(children);
            const isBlock = Boolean(c && /language-/.test(c)) || codeText.includes('\n');
            if (isBlock) {
              return (
                <code {...rest} className={c} style={{ fontFamily: FONT_MONO, fontSize: '12px' }}>
                  {children}
                </code>
              );
            }
            return (
              <code
                {...rest}
                className={c}
                style={{
                  borderRadius: '4px',
                  border: '1px solid hsl(var(--border) / 0.65)',
                  backgroundColor: 'hsl(var(--foreground) / 0.055)',
                  padding: '1px 4px',
                  fontFamily: FONT_MONO,
                  fontSize: '0.92em',
                  fontWeight: 500,
                  lineHeight: 1.45,
                  overflowWrap: 'anywhere',
                  color: 'hsl(var(--foreground))',
                }}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <CodeBlock language={resolveLanguage(children)} streaming={streaming}>
              {isValidElement<{ children?: ReactNode }>(children)
                ? children.props.children
                : children}
            </CodeBlock>
          ),
          table: ({ className: c, children, ...rest }) => (
            <div
              style={{
                margin: '12px 0',
                overflowX: 'auto',
                borderRadius: '7px',
                border: '1px solid hsl(var(--border))',
                boxShadow: '0 1px 2px hsl(var(--border) / 0.35)',
              }}
            >
              <table
                {...rest}
                className={c}
                style={{
                  minWidth: '100%',
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                  fontSize: '0.94em',
                  lineHeight: 1.55,
                }}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ className: c, ...rest }) => (
            <thead
              {...rest}
              className={c}
              style={{
                backgroundColor: 'hsl(var(--surface-muted))',
                borderBottom: '1px solid hsl(var(--border))',
              }}
            />
          ),
          tbody: ({ className: c, ...rest }) => <tbody {...rest} className={c} />,
          tr: ({ className: c, ...rest }) => (
            <tr {...rest} className={c} style={{ borderBottom: '1px solid hsl(var(--border))' }} />
          ),
          th: ({ className: c, children, ...rest }) => (
            <th
              {...rest}
              className={c}
              style={{
                padding: '8px 11px',
                fontWeight: 650,
                fontSize: '0.92em',
                whiteSpace: 'nowrap',
                color: 'hsl(var(--foreground))',
              }}
            >
              {children}
            </th>
          ),
          td: ({ className: c, children, ...rest }) => (
            <td
              {...rest}
              className={c}
              style={{
                padding: '8px 11px',
                minWidth: '96px',
                verticalAlign: 'top',
                color: 'hsl(var(--foreground-muted))',
                borderTop: '1px solid hsl(var(--border))',
              }}
            >
              {children}
            </td>
          ),
          img: ({ className: c, src, alt, ...rest }) => (
            <img
              {...rest}
              src={src}
              alt={alt ?? ''}
              className={c}
              style={{
                margin: '10px 0',
                maxWidth: '100%',
                borderRadius: '8px',
                border: '1px solid hsl(var(--border))',
                boxShadow: 'var(--shadow-sm)',
              }}
            />
          ),
        }}
      >
        {prepared.text}
      </ReactMarkdown>
    </div>
  );
});

export function MarkdownText({
  text,
  streaming = false,
  truncated: _truncated = false,
}: {
  text: string;
  streaming?: boolean;
  truncated?: boolean;
}) {
  const blocks = useMemo(() => (streaming ? splitIntoBlocks(text) : []), [streaming, text]);
  return (
    <div className="relative min-w-0">
      {streaming ? (
        blocks.length > 0 ? (
          blocks.map((block, index) => {
            const active = index === blocks.length - 1;
            return active ? (
              <div key={`active-${blocks.length}`} className="streaming-active-block">
                <MarkdownView text={block.content} streaming />
                {!block.isCode && block.content && (
                  <span
                    className="streaming-type-caret ml-1 inline-block"
                    aria-label="正在接收 Agent 回复"
                    role="status"
                  />
                )}
              </div>
            ) : (
              <MemoizedMarkdownBlock key={`completed-${block.hash}`} content={block.content} />
            );
          })
        ) : (
          <StreamingDots variant="primary" />
        )
      ) : (
        <MarkdownView text={text} />
      )}
    </div>
  );
}

type MarkdownBlock = { content: string; hash: number; isCode: boolean };

function hashMarkdown(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
}

/** PinHarness source behavior: only the active paragraph follows each delta. */
function splitIntoBlocks(value: string): MarkdownBlock[] {
  if (!value) return [];
  const blocks: MarkdownBlock[] = [];
  const lines = value.split('\n');
  let current: string[] = [];
  let inCode = false;

  const flush = () => {
    const content = current.join('\n');
    if (content.trim()) blocks.push({ content, hash: hashMarkdown(content), isCode: inCode });
    current = [];
  };

  for (const line of lines) {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence && !inCode) {
      if (current.length) flush();
      inCode = true;
      current.push(line);
      continue;
    }
    if (fence && inCode) {
      current.push(line);
      flush();
      inCode = false;
      continue;
    }
    if (!inCode && line.trim() === '') {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

const MemoizedMarkdownBlock = memo(function MemoizedMarkdownBlock({
  content,
}: {
  content: string;
}) {
  return <MarkdownView text={content} />;
});

export default MarkdownView;
