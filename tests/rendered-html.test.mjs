import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
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
  assert.match(api, /function hasActivatedDoubleVote/);
  assert.match(api, /activeCard\(player\)\?\.action === "double_vote"/);
  assert.match(api, /const weight = hasActivatedDoubleVote\(player, room\) \? 2 : 1/);
  assert.match(api, /player\.vote_round === room\.round && player\.vote_phase === room\.phase[\s\S]*Ви вже проголосували в цьому раунді/);
  assert.match(api, /vote_round IS NULL OR vote_phase IS NULL OR vote_round != \? OR vote_phase != \?/);
  assert.match(api, /if \(!voteResult\.meta\.changes\)/);
  assert.match(api, /voteCounts/);
  assert.match(api, /room\.round === 1[\s\S]*Перше коло завершено без голосування/);
  assert.match(api, /seatsCount/);
  assert.match(api, /settingsFromRoom/);
  assert.doesNotMatch(api, /selected = "profession"/);
  assert.doesNotMatch(api, /worldEvents|phase === "event"/);
  assert.match(client, /Заповнити до старту/);
  assert.match(client, /Самі відкривають карти й голосують/);
  assert.match(client, /Усі фази без таймерів/);
  assert.match(client, /Передати хід/);
  assert.match(client, /Активувати картку/);
  assert.match(client, /abilityKnown \? "known" : "concealed"/);
  assert.doesNotMatch(client, /player-ability-card \$\{abilityKnown \? "known" : "hidden"\}/);
  assert.match(client, /Authorization: `Bearer \$\{current\.token\}`/);
  assert.match(client, /"X-Player-Id": current\.playerId/);
  assert.match(client, /Обговорення без голосування/);
  assert.match(client, /Перейти до другого раунду/);
  assert.doesNotMatch(client, /lockedProfession/);
  assert.match(client, /Повернутися до гри/);
  assert.match(client, /aria-label="На головний екран"/);
  assert.match(client, /player-profile-list/);
  assert.match(client, /known \? card\?\.value/);
  assert.doesNotMatch(client, /publicCard \? "Відкрито"/);
  assert.doesNotMatch(client, /player\.isYou \? "Приватно"/);
  assert.doesNotMatch(client, /setInterval\(update, 250\)/);
  assert.match(client, /function RoundTimer/);
  assert.match(client, /gameStateFingerprint/);
  assert.match(client, /document\.visibilityState === "visible"/);
  assert.match(client, /scenario-strip/);
  assert.match(client, /round-control-dock/);
  assert.match(client, /function ViewModeControl/);
  assert.match(client, /function PhaseProgress/);
  assert.match(client, /bunker-protocol-view-mode/);
  assert.match(client, /view-\$\{viewMode\}/);
  assert.match(client, /Розгорнути умови/);
  assert.match(client, /classified-summary/);
  assert.match(client, /displayedCategories/);
  assert.match(client, /profile-icon/);
  assert.match(client, /term-help/);
  assert.match(client, /term-help-placeholder/);
  assert.match(client, /player-vote-tally/);
  assert.match(client, /Проголосували \{votesCast\}\/\{eligibleVoters\.length\}/);
  assert.match(client, /title: "Відкрите голосування"/);
  assert.match(client, /role="tooltip"/);
  assert.match(client, /event\.key === "Escape"/);
  assert.match(client, /type="number"/);
  assert.match(client, /seatsCount/);
  assert.doesNotMatch(client, /seatsPercent/);
  assert.doesNotMatch(client, />Журнал</);
  assert.match(data, /makeCharacters/);
  assert.match(data, /phobia: \{ label: "Фобія"/);
  for (const ability of ["reroll_self", "swap", "immunity", "expose", "scramble", "double_vote"]) {
    assert.match(data, new RegExp(`\"${ability}\"`));
  }
  assert.match(css, /\.vote-button[\s\S]*font-size: 11px/);
  assert.match(css, /\.scenario-body p[\s\S]*font-size: 13px/);
  for (const scenario of ["catastrophe", "bunker", "outside"]) {
    assert.match(css, new RegExp(`url\\("\\/scenario-${scenario}\\.avif"\\) type\\("image\\/avif"\\)`));
    assert.match(css, new RegExp(`url\\("\\/scenario-${scenario}\\.webp"\\) type\\("image\\/webp"\\)`));
  }
  assert.match(css, /url\("\/bunker-command\.avif"\) type\("image\/avif"\)/);
  assert.match(css, /url\("\/bunker-command\.webp"\) type\("image\/webp"\)/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)[\s\S]*\.scenario-card/);
  assert.match(css, /@keyframes active-player-pulse/);
  assert.match(css, /@keyframes characteristic-reveal/);
  assert.match(css, /@keyframes player-excluded/);
  assert.match(css, /content-visibility: auto/);
  assert.match(css, /--color-action: #63d5ff/);
  assert.match(css, /\.term-help\.open \.term-tooltip/);
  assert.match(css, /button\.term-help[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.term-tooltip \{[\s\S]*left: -12px;[\s\S]*right: auto/);
  assert.match(css, /\.player-vote-tally/);
  assert.match(css, /\.player-ability-card\.concealed/);
  assert.doesNotMatch(css, /\.player-ability-card\.hidden/);
  assert.match(css, /Lobby scroll performance/);
  assert.match(css, /\.lobby-shell \.ready-dock[\s\S]*backdrop-filter: none/);
  assert.match(css, /\.player-card:has\(\.term-help\.open\)[\s\S]*z-index: 210/);
  assert.match(css, /\.game-shell \.player-profile-list,[\s\S]*overflow: visible/);
  assert.match(css, /Option B: phase-aware tactical game board/);
  assert.match(css, /\.view-tactical \.phase-progress/);
  assert.match(css, /\.view-tactical \.scenario-strip\.collapsed/);
  assert.match(css, /\.view-tactical\.phase-reveal \.player-card\.current/);
  assert.match(css, /\.view-tactical\.phase-voting \.player-card/);
  assert.match(css, /Visual preset A: refined command-center surfaces/);
  assert.match(css, /button\.term-help,[\s\S]*width: calc\(28px \* var\(--dossier-scale\)\)/);
  assert.match(css, /@media \(prefers-contrast: more\)/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(api, /function claimActiveAbility/);
  assert.match(api, /WHERE id = \? AND revealed_json = \?/);
  assert.match(api, /request\.headers\.get\("Authorization"\)/);
  assert.match(api, /room\.status === "finished"[\s\S]*allCards\.filter\(\(card\) => card\.category !== "special"\)/);
  assert.match(api, /ability: abilityUsed \? allCards\.find/);
  assert.match(startFile, /npm run dev -- --port 3000/);
  assert.match(stopFile, /kill "\$SERVER_PID"/);
  assert.notEqual(startStats.mode & 0o100, 0);
  assert.notEqual(stopStats.mode & 0o100, 0);
});

test("does not ship private card values in browser code", async () => {
  const assetsDirectory = new URL("../dist/client/assets/", import.meta.url);
  const assetNames = await readdir(assetsDirectory);
  const javascript = (
    await Promise.all(
      assetNames
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(new URL(name, assetsDirectory), "utf8")),
    )
  ).join("\n");

  for (const privateValue of [
    "Імунітет громади",
    "Інженер систем вентиляції",
    "Каскад сонячних спалахів",
  ]) {
    assert.doesNotMatch(javascript, new RegExp(privateValue));
  }
});
