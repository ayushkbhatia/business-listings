import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// Formatters must not drift with the machine running the tests. Every date, time
// and currency assertion in this suite assumes Asia/Dubai and en-AE.
process.env.TZ = "Asia/Dubai";
