import { sweepE2eData } from "../e2e/helpers/sweep";

const removed = await sweepE2eData();
console.log(
  `removed ${removed.workOrders} work order(s), ` +
    `${removed.users} user(s), ${removed.vessels} vessel(s)`,
);
