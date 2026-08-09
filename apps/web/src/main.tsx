import React from 'react';
import ReactDOM from 'react-dom/client';

function Bootstrap(): React.JSX.Element {
  return <main>AgentHub 正在初始化</main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('缺少应用根节点');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Bootstrap />
  </React.StrictMode>,
);
