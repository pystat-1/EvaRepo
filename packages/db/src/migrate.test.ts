import { describe, expect, it } from "vitest";

describe("concurrent start-ups", () => {
  it("apply each migration once when two start-ups race", async () => {
    const { openBetterSqlite } = await import("./betterSqlite");
    const { migrate } = await import("./migrate");
    const { exec } = openBetterSqlite(":memory:");
    const all = [
      { name: "0000_a", sql: "CREATE TABLE a (x INTEGER)" },
      { name: "0001_b", sql: "INSERT INTO a VALUES (1)" },
    ];
    const [one, two] = await Promise.allSettled([migrate(exec, all), migrate(exec, all)]);
    expect(one.status).toBe("fulfilled");
    expect(two.status).toBe("fulfilled");
    expect(await exec.query("SELECT COUNT(*) AS n FROM a")).toEqual([{ n: 1 }]);
  });
});
