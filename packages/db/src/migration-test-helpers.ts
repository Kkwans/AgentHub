import { eq, getTableColumns, sql } from 'drizzle-orm';
import type { PgliteAgentHubDatabase } from './client.js';
import { tasks } from './schema.js';

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
