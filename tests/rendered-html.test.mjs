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
  assert.match(html, /og-social\.png/);
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
  assert.match(client, /Заповнити вільні місця/);
  assert.match(client, /Допоможуть швидко зібрати повну групу/);
  assert.match(client, /Усі фази без таймерів/);
  assert.match(client, /Передати хід/);
  assert.match(client, /className="ability-control-panel"/);
  assert.match(client, /: "Активувати"/);
  assert.match(client, /abilityKnown \? "known" : "concealed"/);
  assert.doesNotMatch(client, /player-ability-card \$\{abilityKnown \? "known" : "hidden"\}/);
  assert.match(client, /Authorization: `Bearer \$\{current\.token\}`/);
  assert.match(client, /"X-Player-Id": current\.playerId/);
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
  assert.match(client, /if \(!session \|\| showHome\) return/);
  assert.match(client, /if \(!quiet\) setError\(""\)/);
  assert.match(client, /action: "leave"/);
  assert.match(client, /keepalive: true/);
  assert.match(client, /scenario-stack/);
  assert.match(client, /game-room-tools/);
  assert.match(client, /game-action-bar/);
  assert.match(client, /game-vote-status/);
  assert.doesNotMatch(client, /className="round-control-dock"/);
  assert.doesNotMatch(client, /phaseCopy/);
  assert.doesNotMatch(client, /function ViewModeControl/);
  assert.doesNotMatch(client, /function PhaseProgress/);
  assert.doesNotMatch(client, /function DossierTableCenter/);
  assert.doesNotMatch(client, /bunker-protocol-view-mode/);
  assert.match(client, /function ThemeSwitcher/);
  assert.match(client, /bunker-protocol-theme/);
  assert.match(client, /function AbilityActivationNotice/);
  assert.match(client, /ability-activation-layer/);
  assert.match(client, /bunker-protocol-dossier-scale-v3/);
  assert.match(client, /value: 150, label: "Максимум"/);
  assert.match(client, /className="theme-layer"/);
  assert.match(client, /aria-modal="true"/);
  assert.match(client, /Командний/);
  assert.match(client, /Аварійний/);
  assert.match(client, /Біосфера/);
  assert.match(client, /onCreate\(\{ name \}\)/);
  assert.match(client, /Кількість гравців, місця й таймери творець налаштує один раз/);
  assert.match(client, /aria-label={`Відкрити характеристику «\${label}»`}/);
  assert.match(client, /aria-label=\{`\$\{player\.isYou && !player\.active/);
  assert.match(client, /profile-icon/);
  assert.match(client, /term-help/);
  assert.match(client, /term-help-placeholder/);
  assert.match(client, /player-vote-tally/);
  assert.match(client, /\{" · "\}\{votesCast\}\/\{eligibleVoters\.length\}/);
  assert.match(client, /scenariosCollapsed/);
  assert.match(client, /aria-controls="scenario-cards"/);
  assert.match(client, /Приховати умови/);
  assert.match(client, /Показати умови/);
  assert.match(client, /role="tooltip"/);
  assert.match(client, /createPortal/);
  assert.match(client, /term-tooltip-portal/);
  assert.match(client, /dismissOnViewportChange/);
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
  assert.match(css, /\.vote-button \{[\s\S]*min-height: 44px[\s\S]*font-size: max\(12px, calc\(13px \* var\(--dossier-scale\)\)\)/);
  assert.match(css, /\.scenario-body p \{[\s\S]*font-size: var\(--t-label\);[\s\S]*line-height: 1\.42/);
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
  assert.match(css, /\.term-help \{[\s\S]*border-radius: 50%/);
  assert.match(css, /\.term-help:hover, \.term-help\.open/);
  assert.match(css, /\.player-vote-tally/);
  assert.match(css, /\.player-ability-card\.concealed/);
  assert.doesNotMatch(css, /\.player-ability-card\.hidden/);
  assert.match(css, /\.game-shell \{[\s\S]*background-attachment: scroll/);
  assert.match(css, /\.player-card \{[\s\S]*content-visibility: auto/);
  assert.match(css, /\.term-tooltip-portal \{[\s\S]*z-index: 10000/);
  assert.doesNotMatch(css, /\.player-card:has\(\.term-help\.open\)/);
  assert.doesNotMatch(css, /Option B: phase-aware tactical game board/);
  assert.doesNotMatch(css, /Living dossier: a phase-aware table/);
  assert.doesNotMatch(css, /\.view-tactical/);
  assert.doesNotMatch(css, /\.view-dossier/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.player-card:hover, \.player-card:focus-within/);
  assert.match(css, /Atmospheric color themes/);
  assert.match(css, /html\[data-theme="ember"\]/);
  assert.match(css, /html\[data-theme="biosphere"\]/);
  assert.match(css, /\.swatch-command/);
  assert.match(css, /\.swatch-ember/);
  assert.match(css, /\.swatch-biosphere/);
  assert.match(css, /url\("\/bunker-game-field-v2\.png"\)/);
  assert.match(css, /\.ability-activation-layer/);
  assert.match(css, /@keyframes ability-notice-in/);
  assert.match(css, /min-height: calc\(100svh - 56px\)/);
  assert.match(css, /Єдина дизайн-система|єдина дизайн-система/);
  assert.match(css, /\.game-action-bar \{[\s\S]*position: sticky[\s\S]*top: 56px/);
  assert.match(css, /\.game-shell\.scenarios-collapsed \.game-context-panel/);
  assert.match(css, /\.game-shell\.scenarios-collapsed \.scenario-stack \{ display: none; \}/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.game-header \.game-room-tools \.dossier-scale-popover/);
  assert.match(css, /\.game-context-panel \.scenario-body ul \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.game-context-panel \.scenario-body li \{[\s\S]*font-size: var\(--t-micro\);[\s\S]*line-height: 1\.3/);
  assert.match(css, /\.profile-row \.term-help \{ width: max\(20px, calc\(22px \* var\(--dossier-scale\)\)\)/);
  assert.match(css, /@media \(prefers-contrast: more\)/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(api, /function claimActiveAbility/);
  assert.match(api, /action === "leave"/);
  assert.match(api, /DELETE FROM players WHERE id = \?/);
  assert.match(api, /DELETE FROM rooms WHERE code = \?/);
  assert.match(api, /UPDATE players SET seat = 1 WHERE id = \?/);
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
