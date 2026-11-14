import { eq, getTableColumns, sql } from 'drizzle-orm';
import type { PgliteAgentHubDatabase } from './client.js';
import { tasks, agentSessions } from './schema.js';

// Historical schemas must not be queried using columns introduced later.
export async function readLegacyTask(db: PgliteAgentHubDatabase, id: string) {
  const { promptVariablesJson, ...columns } = getTableColumns(tasks);
  void promptVariablesJson;
  const [row] = await db.select(columns).from(tasks).where(eq(tasks.id, id));
  if (!row) throw new Error('Legacy task fixture missing');
  return row;
}
export async function createLegacyTask(
  db: PgliteAgentHubDatabase,
  id: string,
  projectId: string,
  title: string,
  description: string,
) {
  await db.execute(
    sql`insert into tasks(id,project_id,title,description,status) values(${id},${projectId},${title},${description},'BACKLOG')`,
  );
  return readLegacyTask(db, id);
}

export async function createLegacySession(
  db: PgliteAgentHubDatabase,
  input: {
    id: string;
    projectId: string;
    agentId: string;
    taskId?: string;
    title: string;
    cwd: string;
    status: string;
  },
) {
  await db.execute(sql`insert into agent_sessions(id,project_id,agent_id,task_id,title,cwd,status)
    values(${input.id},${input.projectId},${input.agentId},${input.taskId ?? null},${input.title},${input.cwd},${input.status})`);
  const { titleRevision, ...columns } = getTableColumns(agentSessions);
  void titleRevision;
  const [row] = await db.select(columns).from(agentSessions).where(eq(agentSessions.id, input.id));
  if (!row) throw new Error('Legacy session fixture missing');
  return row;
}
