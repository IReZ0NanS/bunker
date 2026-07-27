import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the guest entry screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Бункер: Протокол/);
  assert.match(html, /Гостьовий вхід без реєстрації/);
  assert.match(html, /Увійти гостем і створити гру/);
  assert.match(html, /Жодних акаунтів чи паролів/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("keeps bot play and one-click controls wired", async () => {
  const [api, client, data, css, startFile, stopFile, startStats, stopStats] = await Promise.all([
    readFile(new URL("../worker/game-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/game-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../Запустити Бункер.command", import.meta.url), "utf8"),
    readFile(new URL("../Зупинити Бункер.command", import.meta.url), "utf8"),
    stat(new URL("../Запустити Бункер.command", import.meta.url)),
    stat(new URL("../Зупинити Бункер.command", import.meta.url)),
  ]);

  assert.match(api, /action === "addBots"/);
  assert.match(api, /action === "removeBot"/);
  assert.match(api, /isBot\(current\)/);
  assert.match(api, /room\.phase === "voting" \|\| room\.phase === "runoff"/);
  assert.match(api, /action === "updateSettings"/);
  assert.match(api, /action === "passTurn"/);
  assert.match(api, /action === "advancePhase"/);
  assert.match(api, /action === "useAbility"/);
  assert.doesNotMatch(api, /worldEvents|phase === "event"/);
  assert.match(client, /Заповнити до старту/);
  assert.match(client, /Самі відкривають карти й голосують/);
  assert.match(client, /Усі фази без таймерів/);
  assert.match(client, /Передати хід/);
  assert.match(client, /Активувати картку/);
  assert.match(data, /makeCharacters/);
  assert.match(data, /phobia: \{ label: "Фобія"/);
  for (const ability of ["reroll_self", "swap", "immunity", "expose", "scramble", "double_vote"]) {
    assert.match(data, new RegExp(`\"${ability}\"`));
  }
  assert.match(css, /\.vote-button[\s\S]*font-size: 11px/);
  assert.match(css, /\.scenario-body p[\s\S]*font-size: 13px/);
  assert.match(startFile, /npm run dev -- --port 3000/);
  assert.match(stopFile, /kill "\$SERVER_PID"/);
  assert.notEqual(startStats.mode & 0o100, 0);
  assert.notEqual(stopStats.mode & 0o100, 0);
});
