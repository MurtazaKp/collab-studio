import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addMember, asUser, count, createTestDb, createUser, createWorkspace, expectError, setAccountPlan, type TestUser } from "./support/db";

// Calendar, Polls and Sheets (20261024000015).
let db: PGlite;
let owner: TestUser;
let member: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let ws: string;

const one = async <T>(as: TestUser, sql: string, params: unknown[] = []) =>
  (await asUser(db, as, (tx) => tx.query<T>(sql, params))).rows[0]!;

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "Owner"); // starts on a Team trial: every module
  member = await createUser(db, "Member");
  viewer = await createUser(db, "Viewer");
  outsider = await createUser(db, "Outsider");
  ws = await createWorkspace(db, owner, "Studio");
  await addMember(db, ws, member, "member");
  await addMember(db, ws, viewer, "viewer");
});

describe("modules", () => {
  it("new workspaces get Calendar, Polls and Sheets switched on during the trial", async () => {
    const r = await db.query<{ module_type: string; enabled: boolean }>(
      `select module_type, enabled from workspace_modules where workspace_id = $1 and module_type in ('calendar','polls','sheets') order by position`,
      [ws],
    );
    expect(r.rows).toEqual([
      { module_type: "calendar", enabled: true },
      { module_type: "polls", enabled: true },
      { module_type: "sheets", enabled: true },
    ]);
  });

  it("are not part of Free", async () => {
    const free = await createUser(db, "Thrifty");
    await setAccountPlan(db, free, "free");
    const fws = await createWorkspace(db, free, "Thrifty Co");
    expect(await expectError(asUser(db, free, (tx) => tx.query(`insert into polls (workspace_id, title) values ($1, 'Lunch?')`, [fws])))).toMatch(
      /Polls isn't included in the Free plan/,
    );
  });
});

describe("polls", () => {
  let poll: string;
  let pizza: string;
  let sushi: string;

  const vote = (as: TestUser, option: string, p = poll) =>
    asUser(db, as, (tx) => tx.query(`insert into poll_votes (workspace_id, poll_id, option_id, user_id) values ($1, $2, $3, $4)`, [ws, p, option, as.id]));
  const counts = async (p = poll) =>
    Object.fromEntries(
      (await db.query<{ label: string; vote_count: number }>(`select label, vote_count from poll_options where poll_id = $1 order by position`, [p])).rows.map((r) => [
        r.label,
        r.vote_count,
      ]),
    );

  beforeAll(async () => {
    poll = (await one<{ id: string }>(owner, `insert into polls (workspace_id, title) values ($1, 'Lunch?') returning id`, [ws])).id;
    pizza = (await one<{ id: string }>(owner, `insert into poll_options (workspace_id, poll_id, label, position) values ($1, $2, 'Pizza', 'a') returning id`, [ws, poll])).id;
    sushi = (await one<{ id: string }>(owner, `insert into poll_options (workspace_id, poll_id, label, position) values ($1, $2, 'Sushi', 'b') returning id`, [ws, poll])).id;
  });

  it("count votes live on the options; a single-choice vote replaces the earlier one", async () => {
    await vote(member, pizza);
    await vote(owner, pizza);
    expect(await counts()).toEqual({ Pizza: 2, Sushi: 0 });
    await vote(member, sushi); // changes their mind
    expect(await counts()).toEqual({ Pizza: 1, Sushi: 1 });
    expect(await count(db, `select 1 from poll_votes where poll_id = $1 and user_id = $2`, [poll, member.id])).toBe(1);
  });

  it("allow several choices when the poll says so", async () => {
    const multi = (await one<{ id: string }>(owner, `insert into polls (workspace_id, title, multiple) values ($1, 'Which days?', true) returning id`, [ws])).id;
    const mon = (await one<{ id: string }>(owner, `insert into poll_options (workspace_id, poll_id, label, position) values ($1, $2, 'Mon', 'a') returning id`, [ws, multi])).id;
    const tue = (await one<{ id: string }>(owner, `insert into poll_options (workspace_id, poll_id, label, position) values ($1, $2, 'Tue', 'b') returning id`, [ws, multi])).id;
    await vote(member, mon, multi);
    await vote(member, tue, multi);
    expect(await counts(multi)).toEqual({ Mon: 1, Tue: 1 });
    await expectError(vote(member, tue, multi)); // the same option twice
  });

  it("withdrawing a vote lowers the count; votes are always recorded as the caller", async () => {
    await asUser(db, member, (tx) => tx.query(`delete from poll_votes where poll_id = $1 and user_id = $2`, [poll, member.id]));
    expect((await counts()).Sushi).toBe(0);
    // A vote claimed for someone else is recorded as the person who cast it.
    await asUser(db, member, (tx) =>
      tx.query(`insert into poll_votes (workspace_id, poll_id, option_id, user_id) values ($1, $2, $3, $4)`, [ws, poll, sushi, owner.id]),
    );
    const sushiVoters = await db.query<{ user_id: string }>(`select user_id from poll_votes where option_id = $1`, [sushi]);
    expect(sushiVoters.rows).toEqual([{ user_id: member.id }]);
  });

  it("clients can't change vote counts, viewers and outsiders can't vote", async () => {
    await asUser(db, owner, (tx) => tx.query(`update poll_options set vote_count = 99, label = 'Pizza!' where id = $1`, [pizza]));
    expect(await counts()).not.toHaveProperty("Pizza!", 99);
    await expectError(vote(viewer, pizza));
    await expectError(vote(outsider, pizza));
  });

  it("closed polls refuse votes and withdrawals", async () => {
    const closed = (await one<{ id: string }>(owner, `insert into polls (workspace_id, title) values ($1, 'Old') returning id`, [ws])).id;
    const opt = (await one<{ id: string }>(owner, `insert into poll_options (workspace_id, poll_id, label, position) values ($1, $2, 'Yes', 'a') returning id`, [ws, closed])).id;
    await vote(member, opt, closed);
    await asUser(db, owner, (tx) => tx.query(`update polls set closed_at = now() where id = $1`, [closed]));
    expect(await expectError(vote(owner, opt, closed))).toMatch(/This poll is closed/);
    expect(await expectError(asUser(db, member, (tx) => tx.query(`delete from poll_votes where poll_id = $1`, [closed])))).toMatch(/This poll is closed/);
    const past = (await one<{ id: string }>(owner, `insert into polls (workspace_id, title, closes_at) values ($1, 'Expired', now() - interval '1 minute') returning id`, [ws])).id;
    const popt = (await one<{ id: string }>(owner, `insert into poll_options (workspace_id, poll_id, label, position) values ($1, $2, 'Yes', 'a') returning id`, [ws, past])).id;
    expect(await expectError(vote(member, popt, past))).toMatch(/This poll is closed/);
  });

  it("anonymous polls hide who voted, but not the counts", async () => {
    const anon = (await one<{ id: string }>(owner, `insert into polls (workspace_id, title, anonymous) values ($1, 'Secret', true) returning id`, [ws])).id;
    const opt = (await one<{ id: string }>(owner, `insert into poll_options (workspace_id, poll_id, label, position) values ($1, $2, 'Yes', 'a') returning id`, [ws, anon])).id;
    await vote(member, opt, anon);
    await vote(owner, opt, anon);
    expect(await asUser(db, owner, (tx) => count(tx, `select 1 from poll_votes where poll_id = $1`, [anon]))).toBe(1); // only their own
    expect(await asUser(db, viewer, (tx) => count(tx, `select 1 from poll_votes where poll_id = $1`, [anon]))).toBe(0);
    const seen = await one<{ vote_count: number }>(viewer, `select vote_count from poll_options where id = $1`, [opt]);
    expect(seen.vote_count).toBe(2);
  });
});

describe("calendar", () => {
  let cal: string;

  beforeAll(async () => {
    cal = (await one<{ id: string }>(owner, `insert into calendars (workspace_id, title) values ($1, 'Team') returning id`, [ws])).id;
  });

  it("creates events and notifies attendees (not the organiser)", async () => {
    await asUser(db, owner, (tx) =>
      tx.query(
        `insert into calendar_events (workspace_id, calendar_id, title, starts_at, ends_at, attendee_ids)
         values ($1, $2, 'Standup', now() + interval '1 day', now() + interval '1 day 15 minutes', array[$3, $4]::uuid[])`,
        [ws, cal, member.id, owner.id],
      ),
    );
    const n = await db.query<{ user_id: string; kind: string; link: string }>(`select user_id, kind, link from notifications where kind = 'event_invite'`);
    expect(n.rows).toEqual([{ user_id: member.id, kind: "event_invite", link: `/w/${ws}/calendar/${cal}` }]);
  });

  it("rejects attendees outside the workspace and events that end before they start", async () => {
    expect(
      await expectError(
        asUser(db, owner, (tx) =>
          tx.query(
            `insert into calendar_events (workspace_id, calendar_id, title, starts_at, ends_at, attendee_ids) values ($1, $2, 'X', now(), now(), array[$3]::uuid[])`,
            [ws, cal, outsider.id],
          ),
        ),
      ),
    ).toMatch(/Attendees must be members/);
    await expectError(
      asUser(db, owner, (tx) =>
        tx.query(`insert into calendar_events (workspace_id, calendar_id, title, starts_at, ends_at) values ($1, $2, 'Y', now(), now() - interval '1 hour')`, [ws, cal]),
      ),
    );
  });

  it("is read-only for viewers and invisible to outsiders", async () => {
    await expectError(
      asUser(db, viewer, (tx) =>
        tx.query(`insert into calendar_events (workspace_id, calendar_id, title, starts_at, ends_at) values ($1, $2, 'Z', now(), now())`, [ws, cal]),
      ),
    );
    expect(await asUser(db, viewer, (tx) => count(tx, `select 1 from calendar_events where calendar_id = $1`, [cal]))).toBe(1);
    expect(await asUser(db, outsider, (tx) => count(tx, `select 1 from calendar_events where calendar_id = $1`, [cal]))).toBe(0);
  });
});

describe("sheets", () => {
  let sheet: string;

  beforeAll(async () => {
    sheet = (await one<{ id: string }>(owner, `insert into sheets (workspace_id, title) values ($1, 'Budget') returning id`, [ws])).id;
  });

  const setCell = (as: TestUser, row: number, col: number, value: string) =>
    asUser(db, as, (tx) =>
      tx.query(
        `insert into sheet_cells (workspace_id, sheet_id, row_index, col_index, value) values ($1, $2, $3, $4, $5)
         on conflict (sheet_id, row_index, col_index) do update set value = excluded.value`,
        [ws, sheet, row, col, value],
      ),
    );

  it("stores cells per position and records who edited them", async () => {
    await setCell(owner, 0, 0, "Rent");
    await setCell(member, 0, 1, "1200");
    await setCell(member, 0, 0, "Office rent");
    const cells = await db.query<{ row_index: number; col_index: number; value: string; updated_by: string }>(
      `select row_index, col_index, value, updated_by from sheet_cells where sheet_id = $1 order by col_index`,
      [sheet],
    );
    expect(cells.rows).toEqual([
      { row_index: 0, col_index: 0, value: "Office rent", updated_by: member.id },
      { row_index: 0, col_index: 1, value: "1200", updated_by: member.id },
    ]);
  });

  it("keeps cells inside the grid and limits their size", async () => {
    await expectError(setCell(owner, 1000, 0, "x"));
    await expectError(setCell(owner, 0, 52, "x"));
    await expectError(setCell(owner, 1, 1, "x".repeat(2001)));
  });

  it("is read-only for viewers", async () => {
    await expectError(setCell(viewer, 5, 5, "nope"));
  });
});

describe("sheet options (20261024000016)", () => {
  let sheet: string;

  const cellsOf = async () =>
    (
      await db.query<{ row_index: number; col_index: number; value: string }>(
        `select row_index, col_index, value from sheet_cells where sheet_id = $1 order by row_index, col_index`,
        [sheet],
      )
    ).rows.map((c) => `${c.row_index},${c.col_index}=${c.value}`);
  const put = (as: TestUser, row: number, col: number, value: string, format: object = {}) =>
    asUser(db, as, (tx) =>
      tx.query(
        `insert into sheet_cells (workspace_id, sheet_id, row_index, col_index, value, format) values ($1, $2, $3, $4, $5, $6)
         on conflict (sheet_id, row_index, col_index) do update set value = excluded.value, format = excluded.format`,
        [ws, sheet, row, col, value, JSON.stringify(format)],
      ),
    );
  const shift = (as: TestUser, axis: string, at: number, delta: number) =>
    asUser(db, as, (tx) => tx.query(`select sheet_shift($1, $2, $3, $4)`, [sheet, axis, at, delta]));

  beforeAll(async () => {
    sheet = (await one<{ id: string }>(owner, `insert into sheets (workspace_id, title) values ($1, 'Plan') returning id`, [ws])).id;
    await put(owner, 0, 0, "A1", { b: true });
    await put(owner, 1, 0, "A2");
    await put(owner, 2, 1, "B3");
  });

  it("stores formatting and caps its size", async () => {
    const f = await db.query<{ format: { b: boolean } }>(`select format from sheet_cells where sheet_id = $1 and row_index = 0 and col_index = 0`, [sheet]);
    expect(f.rows[0]!.format).toEqual({ b: true });
    await expectError(put(owner, 5, 5, "x", { junk: "y".repeat(600) }));
  });

  it("inserts and deletes rows, moving cells and their formats", async () => {
    await shift(member, "row", 1, 2); // two rows above A2
    expect(await cellsOf()).toEqual(["0,0=A1", "3,0=A2", "4,1=B3"]);
    await shift(member, "row", 0, -1); // delete the first row
    expect(await cellsOf()).toEqual(["2,0=A2", "3,1=B3"]);
    const rows = await db.query<{ row_count: number }>(`select row_count from sheets where id = $1`, [sheet]);
    expect(rows.rows[0]!.row_count).toBe(101);
  });

  it("inserts and deletes columns, keeping column widths aligned", async () => {
    await asUser(db, owner, (tx) => tx.query(`update sheets set col_widths = '{"0": 80, "1": 200}' where id = $1`, [sheet]));
    await shift(owner, "col", 1, 1);
    expect(await cellsOf()).toEqual(["2,0=A2", "3,2=B3"]);
    const w = await db.query<{ col_widths: Record<string, number> }>(`select col_widths from sheets where id = $1`, [sheet]);
    expect(w.rows[0]!.col_widths).toEqual({ "0": 80, "2": 200 });
    await shift(owner, "col", 0, -1);
    expect(await cellsOf()).toEqual(["3,1=B3"]);
  });

  it("is refused for viewers and bad arguments", async () => {
    expect(await expectError(shift(viewer, "row", 0, 1))).toMatch(/permission|denied/i);
    await expectError(shift(owner, "diagonal", 0, 1));
    await expectError(shift(owner, "row", -1, 1));
    await expectError(shift(owner, "row", 0, 0));
  });
});
