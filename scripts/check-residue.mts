import { connect } from "./db.mts";

/** Confirms an e2e run cleaned up after itself and left the demo data intact. */
const db = await connect();
try {
  const count = async (sql: string) => (await db.query(sql)).rows[0].count as string;
  console.log("users            :", await count("select count(*) from public.users"));
  console.log("vessels          :", await count("select count(*) from public.vessels"));
  console.log("work orders      :", await count("select count(*) from public.work_orders"));
  console.log("leftover e2e users   :",
    await count("select count(*) from public.users where email like '%@e2e.test'"));
  console.log("leftover e2e vessels :",
    await count(`select count(*) from public.vessels
                  where name like 'Lifecycle %' or name like 'Admiralty %'
                     or name like 'Trial Ship %' or name like 'Bad IMO %'`));
  console.log("showcase intact  :",
    await count("select count(*) from public.work_orders where reference in " +
      "('WO-000001','WO-000002','WO-000003','WO-000004','WO-000005')"), "/ 5");
} finally {
  await db.end();
}
