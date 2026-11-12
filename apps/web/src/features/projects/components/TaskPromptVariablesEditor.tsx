import { AhButton, AhErrorState, AhTextarea } from '@agenthub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type TaskRecord } from '../../../lib/api';

export function TaskPromptVariablesEditor({
  task,
  disabled,
  onSavingChange,
  onSaved,
}: {
  task: TaskRecord;
  disabled: boolean;
  onSavingChange: (key: string, saving: boolean) => void;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const savedText = JSON.stringify(task.promptVariablesJson ?? {}, null, 2);
  const [text, setText] = useState(savedText);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) setText(savedText);
  }, [dirty, savedText]);
  let variables: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      variables = parsed as Record<string, unknown>;
  } catch {
    /* Keep the draft intact while typing invalid JSON. */
  }
  const save = async () => {
    if (!live.current || busy.current || disabled || !variables || !dirty) return;
    const key = `${task.projectId}:${task.id}`;
    busy.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    onSavingChange(key, true);
    try {
      const updated = await api.patch<TaskRecord>(`/tasks/${encodeURIComponent(task.id)}`, {
        promptVariables: variables,
      });
      if (
        !updated ||
        updated.id !== task.id ||
        updated.projectId !== task.projectId ||
        !updated.promptVariablesJson ||
        typeof updated.promptVariablesJson !== 'object' ||
        Array.isArray(updated.promptVariablesJson)
      )
        throw new Error('保存响应无法确认，请核对原任务的变量。');
      const savedVariables = updated.promptVariablesJson;
      client.setQueryData<TaskRecord[]>(['tasks', task.projectId], (rows) =>
        rows?.map((row) =>
          row.id === task.id ? { ...row, promptVariablesJson: savedVariables } : row,
        ),
      );
      if (live.current) {
        setDirty(false);
        setText(JSON.stringify(updated.promptVariablesJson, null, 2));
        setMessage('变量已保存。');
        onSaved();
      }
    } catch (failure) {
      if (live.current)
        setError(
          failure instanceof Error ? failure.message : '保存结果无法确认，请核对原任务后重试。',
        );
    } finally {
      busy.current = false;
      onSavingChange(key, false);
      if (live.current) setSaving(false);
      void client.invalidateQueries({ queryKey: ['tasks', task.projectId] });
    }
  };
  return (
    <>
      <AhTextarea
        label="任务 Prompt 变量（JSON 对象）"
        value={text}
        disabled={disabled || saving}
        minRows={4}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setDirty(true);
          setError('');
          setMessage('');
        }}
      />
      <p>保存会替换任务变量；使用 {'{}'} 清空。仅影响尚未开始的任务，不会自动启动 Agent。</p>
      {!variables ? <p role="alert">请输入有效的 JSON 对象。</p> : null}
      {error ? <AhErrorState title="变量保存未完成" description={error} /> : null}
      {message ? <p role="status">{message}</p> : null}
      <AhButton
        size="xs"
        variant="light"
        disabled={disabled || saving || !variables || !dirty}
        loading={saving}
        onClick={() => void save()}
      >
        保存变量
      </AhButton>
    </>
  );
}
