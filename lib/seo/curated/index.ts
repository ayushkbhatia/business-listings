/**
 * Board 6b — curated lists.
 *
 * Four modules, and the split is the design:
 *
 *   `criteria`    pure. What a list may be chosen on, and who fails it.
 *   `read`        the reader's page. Snapshot only, one live check.
 *   `audit`       the only path that writes a member, and the bar it applies.
 *   `queues`      the read side of the above — what board 6f renders. Split
 *                 out because the console must not import a module that
 *                 mutates without an audit row, and the sweep deliberately
 *                 does exactly that.
 *   `compliance`  the nightly job that writes to a queue and acts on almost
 *                 nothing.
 *   `recipients`  the eight the RFQ card names.
 */
export * from "./criteria";
export * from "./read";
export * from "./audit";
export * from "./compliance";
export * from "./queues";
export * from "./recipients";
