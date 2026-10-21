import { loadRootEnv } from "@projectos/db";
loadRootEnv();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
