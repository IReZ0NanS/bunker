import {
  bunkers,
  catastrophes,
  categoryOrder,
  makeCard,
  makeCharacters,
  outsideWorlds,
  pick,
  type ActiveAbility,
  type CharacterCategory,
  type CharacterCard,
} from "./game-data";

type Env = { DB: D1Database };

type Settings = {
  minPlayers: number;
  maxPlayers: number;
  seatsCount: number;
  revealSeconds: number;
  discussionSeconds: number;
  votingSeconds: number;
  publicVotes: boolean;
  excludedCanVote: boolean;
  victoryRule: "survival" | "legacy";
};

type RoomRow = {
  code: string;
  status: "lobby" | "playing" | "finished";
  settings_json: string;
  phase: string;
  round: number;
  phase_ends_at: number | null;
  turn_seat: number | null;
  catastrophe_json: string | null;
  bunker_json: string | null;
  outside_json: string | null;
  current_event_json: string | null;
  runoff_json: string | null;
  seats: number;
  created_at: number;
  updated_at: number;
  log_json: string;
};

type PlayerRow = {
  id: string;
  room_code: string;
  name: string;
  token: string;
  seat: number;
  ready: number;
  active: number;
  last_seen: number;
  character_json: string;
  revealed_json: string;
  vote_target: string | null;
  vote_round: number | null;
  vote_phase: string | null;
};

type LogEntry = {
  at: number;
  kind: "system" | "reveal" | "vote" | "ability";
  text: string;
};

const defaultSettings: Settings = {
  minPlayers: 8,
  maxPlayers: 8,
  seatsCount: 4,
  revealSeconds: 0,
  discussionSeconds: 0,
  votingSeconds: 0,
  publicVotes: true,
  excludedCanVote: false,
  victoryRule: "survival",
};

let schemaReady = false;

async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  await db.batch([
    db
      .prepare(
        `CREATE TABLE IF NOT EXISTS rooms (
          code TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'lobby',
          settings_json TEXT NOT NULL,
          phase TEXT NOT NULL DEFAULT 'lobby',
          round INTEGER NOT NULL DEFAULT 0,
          phase_ends_at INTEGER,
          turn_seat INTEGER,
          catastrophe_json TEXT,
          bunker_json TEXT,
          outside_json TEXT,
          current_event_json TEXT,
          runoff_json TEXT,
          seats INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          log_json TEXT NOT NULL DEFAULT '[]'
        )`,
      ),
    db
      .prepare(
        `CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY,
          room_code TEXT NOT NULL,
          name TEXT NOT NULL,
          token TEXT NOT NULL,
          seat INTEGER NOT NULL,
          ready INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          last_seen INTEGER NOT NULL,
          character_json TEXT NOT NULL DEFAULT '[]',
          revealed_json TEXT NOT NULL DEFAULT '[]',
          vote_target TEXT,
          vote_round INTEGER,
          vote_phase TEXT,
          FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
        )`,
      ),
    db.prepare("CREATE INDEX IF NOT EXISTS players_room_idx ON players(room_code, seat)"),
  ]);
  schemaReady = true;
}

function json<T>(value: T, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function cleanDuration(value: unknown, min: number, max: number, fallback: number) {
  if (Number(value) === 0) return 0;
  return clamp(value, min, max, fallback);
}

function phaseDeadline(seconds: number, multiplier = 1) {
  return seconds > 0 ? Date.now() + Math.round(seconds * multiplier) * 1000 : null;
}

function cleanName(value: unknown) {
  return text(value).replace(/[<>]/g, "").slice(0, 24);
}

function isBot(player: PlayerRow) {
  return player.token.startsWith("bot:");
}

const botNames = [
  "Атлас",
  "Лада",
  "Орест",
  "Міра",
  "Терен",
  "Веста",
  "Скіф",
  "Зоря",
  "Крук",
  "Тайра",
  "Марс",
] as const;

function guestName(players: PlayerRow[]) {
  let number = players.filter((player) => player.name.startsWith("Гість ")).length + 1;
  while (players.some((player) => player.name.toLocaleLowerCase("uk") === `гість ${number}`)) number += 1;
  return `Гість ${number}`;
}

function availableBotName(players: PlayerRow[], offset = 0) {
  const used = new Set(players.map((player) => player.name.toLocaleLowerCase("uk")));
  const available = botNames.filter((name) => !used.has(name.toLocaleLowerCase("uk")));
  return available[offset] ?? `Бот ${players.filter(isBot).length + offset + 1}`;
}

function cleanSettings(input: unknown): Settings {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const maxPlayers = clamp(source.maxPlayers, 4, 12, defaultSettings.maxPlayers);
  const minPlayers = clamp(source.minPlayers, 4, maxPlayers, maxPlayers);
  const legacySeats = Math.max(
    2,
    Math.floor((maxPlayers * clamp(source.seatsPercent, 40, 60, 50)) / 100),
  );
  return {
    minPlayers,
    maxPlayers,
    seatsCount: clamp(source.seatsCount, 2, maxPlayers - 1, legacySeats),
    revealSeconds: cleanDuration(source.revealSeconds, 15, 300, defaultSettings.revealSeconds),
    discussionSeconds: cleanDuration(source.discussionSeconds, 30, 600, defaultSettings.discussionSeconds),
    votingSeconds: cleanDuration(source.votingSeconds, 15, 300, defaultSettings.votingSeconds),
    publicVotes: source.publicVotes === undefined ? defaultSettings.publicVotes : Boolean(source.publicVotes),
    excludedCanVote: source.excludedCanVote === undefined ? defaultSettings.excludedCanVote : Boolean(source.excludedCanVote),
    victoryRule: source.victoryRule === "legacy" ? "legacy" : "survival",
  };
}

function id(length = 24) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
}

const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => codeAlphabet[value % codeAlphabet.length]).join("");
}

async function roomByCode(db: D1Database, code: string) {
  return db.prepare("SELECT * FROM rooms WHERE code = ?").bind(code).first<RoomRow>();
}

async function playersByRoom(db: D1Database, code: string) {
  const result = await db
    .prepare("SELECT * FROM players WHERE room_code = ? ORDER BY seat ASC")
    .bind(code)
    .all<PlayerRow>();
  return result.results;
}

function parse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function settingsFromRoom(room: RoomRow) {
  return cleanSettings(parse<Record<string, unknown>>(room.settings_json, {}));
}

async function appendLog(db: D1Database, room: RoomRow, entry: Omit<LogEntry, "at">) {
  const log = parse<LogEntry[]>(room.log_json, []);
  log.push({ ...entry, at: Date.now() });
  const next = log.slice(-30);
  room.log_json = JSON.stringify(next);
  await db.prepare("UPDATE rooms SET log_json = ?, updated_at = ? WHERE code = ?").bind(room.log_json, Date.now(), room.code).run();
}

async function authenticatedPlayer(db: D1Database, code: string, playerId: string, token: string) {
  return db
    .prepare("SELECT * FROM players WHERE room_code = ? AND id = ? AND token = ?")
    .bind(code, playerId, token)
    .first<PlayerRow>();
}

async function maybeStart(db: D1Database, room: RoomRow) {
  if (room.status !== "lobby") return room;
  const settings = settingsFromRoom(room);
  const players = await playersByRoom(db, room.code);
  if (players.length < settings.minPlayers || players.some((player) => !player.ready)) return room;

  const now = Date.now();
  const seats = Math.min(players.length - 1, settings.seatsCount);
  const characters = makeCharacters(players.length);
  const assignments = players.map((player, index) =>
    db
      .prepare("UPDATE players SET character_json = ?, revealed_json = '[]', active = 1 WHERE id = ?")
      .bind(JSON.stringify(characters[index]), player.id),
  );
  await db.batch(assignments);
  await db
    .prepare(
      `UPDATE rooms SET status = 'playing', phase = 'briefing', round = 1,
       phase_ends_at = ?, turn_seat = NULL, catastrophe_json = ?, bunker_json = ?,
       outside_json = ?, current_event_json = NULL, runoff_json = NULL, seats = ?, updated_at = ?
       WHERE code = ?`,
    )
    .bind(
      settings.revealSeconds === 0 ? null : now + 8_000,
      JSON.stringify(pick(catastrophes)),
      JSON.stringify(pick(bunkers)),
      JSON.stringify(pick(outsideWorlds)),
      seats,
      now,
      room.code,
    )
    .run();
  room = (await roomByCode(db, room.code))!;
  await appendLog(db, room, {
    kind: "system",
    text: `Протокол активовано. Місць у сховищі: ${seats} із ${players.length}.`,
  });
  return (await roomByCode(db, room.code))!;
}

function storedPlayerState(player: PlayerRow) {
  return parse<string[]>(player.revealed_json, []);
}

function revealedCategories(player: PlayerRow) {
  return storedPlayerState(player).filter((value) =>
    categoryOrder.includes(value as CharacterCategory),
  );
}

function playerHasFlag(player: PlayerRow, flag: string) {
  return storedPlayerState(player).includes(flag);
}

function phaseFlag(kind: "immune" | "double-vote", room: RoomRow) {
  return `@${kind}:${room.round}:${room.phase}`;
}

async function claimActiveAbility(db: D1Database, player: PlayerRow, ...extraFlags: string[]) {
  const stored = storedPlayerState(player);
  if (stored.includes("@ability-used")) return false;
  const next = [...stored, "@ability-used"];
  for (const flag of extraFlags) {
    if (!next.includes(flag)) next.push(flag);
  }
  const nextJson = JSON.stringify(next);
  const result = await db
    .prepare("UPDATE players SET revealed_json = ? WHERE id = ? AND revealed_json = ?")
    .bind(nextJson, player.id, player.revealed_json)
    .run();
  if (!result.meta.changes) return false;
  player.revealed_json = nextJson;
  return true;
}

function activeCard(player: PlayerRow) {
  return parse<CharacterCard[]>(player.character_json, []).find((card) => card.category === "special");
}

function hasActivatedDoubleVote(player: PlayerRow, room: RoomRow) {
  return activeCard(player)?.action === "double_vote" &&
    playerHasFlag(player, "@ability-used") &&
    playerHasFlag(player, phaseFlag("double-vote", room));
}

function isCharacterCategory(value: string): value is CharacterCategory {
  return categoryOrder.includes(value as CharacterCategory);
}

async function openCategory(db: D1Database, room: RoomRow, player: PlayerRow, category?: string) {
  const cards = parse<CharacterCard[]>(player.character_json, []);
  const stored = storedPlayerState(player);
  const revealed = revealedCategories(player);
  let selected = category;
  if (!selected || !categoryOrder.includes(selected as (typeof categoryOrder)[number]) || revealed.includes(selected)) {
    selected = categoryOrder.find((item) => !revealed.includes(item));
  }
  if (!selected) return;
  stored.push(selected);
  await db.prepare("UPDATE players SET revealed_json = ? WHERE id = ?").bind(JSON.stringify(stored), player.id).run();
  const card = cards.find((item) => item.category === selected);
  await appendLog(db, room, {
    kind: "reveal",
    text: `${player.name} відкриває: ${card?.label ?? selected} — ${card?.value ?? "невідомо"}.`,
  });
}

async function beginReveal(db: D1Database, room: RoomRow) {
  const settings = settingsFromRoom(room);
  const players = (await playersByRoom(db, room.code)).filter((player) => player.active);
  const first = players[0];
  if (!first) return;
  await db
    .prepare("UPDATE rooms SET phase = 'reveal', turn_seat = ?, phase_ends_at = ?, updated_at = ? WHERE code = ?")
    .bind(first.seat, phaseDeadline(settings.revealSeconds), Date.now(), room.code)
    .run();
}

async function moveRevealTurn(db: D1Database, room: RoomRow) {
  const settings = settingsFromRoom(room);
  const players = (await playersByRoom(db, room.code)).filter((player) => player.active);
  const pending = players.filter((player) => revealedCategories(player).length < room.round);
  if (!pending.length) {
    await db
      .prepare("UPDATE rooms SET phase = 'discussion', turn_seat = NULL, phase_ends_at = ?, updated_at = ? WHERE code = ?")
      .bind(phaseDeadline(settings.discussionSeconds), Date.now(), room.code)
      .run();
    await appendLog(db, room, { kind: "system", text: "Відкрита загальна дискусія." });
    return;
  }
  const next = pending.find((player) => player.seat > (room.turn_seat ?? 0)) ?? pending[0]!;
  await db
    .prepare("UPDATE rooms SET turn_seat = ?, phase_ends_at = ?, updated_at = ? WHERE code = ?")
    .bind(next.seat, phaseDeadline(settings.revealSeconds), Date.now(), room.code)
    .run();
}

function eligibleVoters(players: PlayerRow[], settings: Settings) {
  return settings.excludedCanVote ? players : players.filter((player) => player.active);
}

async function beginVoting(db: D1Database, room: RoomRow) {
  if (room.round === 1) {
    await appendLog(db, room, { kind: "system", text: "Перше коло завершено без голосування." });
    await nextRound(db, room);
    return;
  }
  const settings = settingsFromRoom(room);
  await db.batch([
    db.prepare("UPDATE players SET vote_target = NULL, vote_round = NULL, vote_phase = NULL WHERE room_code = ?").bind(room.code),
    db
      .prepare("UPDATE rooms SET phase = 'voting', phase_ends_at = ?, runoff_json = NULL, updated_at = ? WHERE code = ?")
      .bind(phaseDeadline(settings.votingSeconds), Date.now(), room.code),
  ]);
  await appendLog(db, room, { kind: "system", text: "Голосування відкрито." });
}

function tally(players: PlayerRow[], room: RoomRow, settings: Settings) {
  const allowed = new Set(eligibleVoters(players, settings).map((player) => player.id));
  const counts = new Map<string, number>();
  for (const player of players) {
    if (!allowed.has(player.id) || player.vote_round !== room.round || player.vote_phase !== room.phase || !player.vote_target) continue;
    const weight = hasActivatedDoubleVote(player, room) ? 2 : 1;
    counts.set(player.vote_target, (counts.get(player.vote_target) ?? 0) + weight);
  }
  for (const candidate of players) {
    if (!playerHasFlag(candidate, phaseFlag("immune", room))) continue;
    counts.set(candidate.id, Math.max(0, (counts.get(candidate.id) ?? 0) - 1));
  }
  return counts;
}

async function finishGame(db: D1Database, room: RoomRow) {
  await db
    .prepare("UPDATE rooms SET status = 'finished', phase = 'finished', phase_ends_at = NULL, turn_seat = NULL, updated_at = ? WHERE code = ?")
    .bind(Date.now(), room.code)
    .run();
  await appendLog(db, room, { kind: "system", text: "Шлюз зачинено. Склад групи визначено." });
}

async function eliminate(db: D1Database, room: RoomRow, playerId: string) {
  const player = await db.prepare("SELECT * FROM players WHERE id = ?").bind(playerId).first<PlayerRow>();
  if (!player?.active) return;
  await db.prepare("UPDATE players SET active = 0 WHERE id = ?").bind(playerId).run();
  await appendLog(db, room, { kind: "vote", text: `${player.name} залишається за межами основного сховища.` });
  const active = (await playersByRoom(db, room.code)).filter((item) => item.active);
  if (active.length <= room.seats) {
    await finishGame(db, room);
    return;
  }

  await nextRound(db, room);
}

async function resolveVote(db: D1Database, room: RoomRow) {
  const settings = settingsFromRoom(room);
  const players = await playersByRoom(db, room.code);
  const counts = tally(players, room, settings);
  const candidates = players.filter((player) => player.active);
  const maxVotes = Math.max(0, ...candidates.map((player) => counts.get(player.id) ?? 0));
  let leaders = candidates.filter((player) => (counts.get(player.id) ?? 0) === maxVotes);

  if (!leaders.length || maxVotes === 0) leaders = candidates;
  if (leaders.length > 1 && room.phase === "voting") {
    const tiedIds = leaders.map((player) => player.id);
    await db.batch([
      db.prepare("UPDATE players SET vote_target = NULL, vote_round = NULL, vote_phase = NULL WHERE room_code = ?").bind(room.code),
      db
        .prepare("UPDATE rooms SET phase = 'runoff', runoff_json = ?, phase_ends_at = ?, updated_at = ? WHERE code = ?")
        .bind(
          JSON.stringify(tiedIds),
          settings.votingSeconds === 0 ? null : phaseDeadline(settings.votingSeconds, 0.7),
          Date.now(),
          room.code,
        ),
    ]);
    await appendLog(db, room, { kind: "vote", text: `Нічия. Переголосування між: ${leaders.map((player) => player.name).join(", ")}.` });
    return;
  }

  const eliminated = leaders[Math.floor(Math.random() * leaders.length)]!;
  await eliminate(db, room, eliminated.id);
}

async function nextRound(db: D1Database, room: RoomRow) {
  const next = room.round + 1;
  await db
    .prepare(
      "UPDATE rooms SET phase = 'reveal', round = ?, current_event_json = NULL, runoff_json = NULL, turn_seat = NULL, phase_ends_at = NULL, updated_at = ? WHERE code = ?",
    )
    .bind(next, Date.now(), room.code)
    .run();
  const refreshed = (await roomByCode(db, room.code))!;
  await appendLog(db, refreshed, { kind: "system", text: `Раунд ${next}. Час відкрити нову характеристику.` });
  await beginReveal(db, refreshed);
}

async function advanceGame(db: D1Database, code: string) {
  let room = await roomByCode(db, code);
  if (!room) return null;
  room = await maybeStart(db, room);

  for (let guard = 0; guard < 20 && room.status === "playing"; guard += 1) {
    if (room.phase === "reveal") {
      const players = await playersByRoom(db, code);
      const current = players.find((player) => player.active && player.seat === room!.turn_seat);
      if (current && isBot(current)) {
        if (revealedCategories(current).length < room.round) await openCategory(db, room, current);
        await moveRevealTurn(db, room);
        room = (await roomByCode(db, code))!;
        continue;
      }
    }

    if (room.phase === "voting" || room.phase === "runoff") {
      const settings = settingsFromRoom(room);
      const players = await playersByRoom(db, code);
      const runoff = parse<string[]>(room.runoff_json, []);
      const candidates = players.filter((candidate) => candidate.active && (room!.phase !== "runoff" || runoff.includes(candidate.id)));
      const bots = eligibleVoters(players, settings).filter(
        (bot) => isBot(bot) && (bot.vote_round !== room!.round || bot.vote_phase !== room!.phase),
      );

      if (bots.length) {
        const votes = bots.flatMap((bot) => {
          const options = candidates.filter((candidate) => candidate.id !== bot.id);
          const target = options[Math.floor(Math.random() * options.length)];
          return target
            ? [
                db
                  .prepare("UPDATE players SET vote_target = ?, vote_round = ?, vote_phase = ? WHERE id = ?")
                  .bind(target.id, room!.round, room!.phase, bot.id),
              ]
            : [];
        });
        if (votes.length) await db.batch(votes);

        const refreshedPlayers = await playersByRoom(db, code);
        const required = eligibleVoters(refreshedPlayers, settings);
        if (required.every((player) => player.vote_round === room!.round && player.vote_phase === room!.phase)) {
          await resolveVote(db, room);
          room = (await roomByCode(db, code))!;
          continue;
        }
      }
    }

    const now = Date.now();
    if (!room.phase_ends_at || now < room.phase_ends_at) break;

    if (room.phase === "briefing") {
      await beginReveal(db, room);
    } else if (room.phase === "reveal") {
      const players = await playersByRoom(db, code);
      const current = players.find((player) => player.active && player.seat === room!.turn_seat);
      if (current && revealedCategories(current).length < room.round) await openCategory(db, room, current);
      await moveRevealTurn(db, room);
    } else if (room.phase === "discussion") {
      await beginVoting(db, room);
    } else if (room.phase === "voting" || room.phase === "runoff") {
      await resolveVote(db, room);
    } else {
      break;
    }
    room = (await roomByCode(db, code))!;
  }
  return room;
}

function outcome(players: PlayerRow[], room: RoomRow) {
  const survivors = players.filter((player) => player.active);
  const cards = survivors.flatMap((player) => parse<CharacterCard[]>(player.character_json, []));
  const positives = cards.filter((card) => card.tone === "good").length;
  const risks = cards.filter((card) => card.tone === "risk").length;
  const settings = settingsFromRoom(room);
  const biology = cards.filter((card) => card.category === "biology").map((card) => card.value);
  const diversity = new Set(biology.map((value) => (value.startsWith("Жінка") ? "f" : value.startsWith("Чоловік") ? "m" : "x"))).size;
  const score = Math.max(22, Math.min(94, 46 + positives * 3 - risks * 4 + diversity * 5));
  const legacyReady = diversity >= 2;
  return {
    score,
    title: score >= 75 ? "Стійка експедиція" : score >= 55 ? "Шанси є" : "Крихкий баланс",
    summary:
      score >= 75
        ? "У групи є взаємодоповнювальні навички, запас стійкості та реалістичний план відновлення."
        : score >= 55
          ? "Група може пережити ізоляцію, але перші місяці вимагатимуть дисципліни й жорстких пріоритетів."
          : "Склад має критичні прогалини. Виживання залежатиме від зовнішніх знахідок і швидкого навчання.",
    legacyReady,
    victoryRule: settings.victoryRule,
  };
}

async function publicState(db: D1Database, room: RoomRow, viewer: PlayerRow) {
  const players = await playersByRoom(db, room.code);
  const settings = settingsFromRoom(room);
  const now = Date.now();
  const runoff = parse<string[]>(room.runoff_json, []);
  const votes = settings.publicVotes && (room.phase === "voting" || room.phase === "runoff")
    ? Object.fromEntries(players.filter((player) => player.vote_target).map((player) => [player.id, player.vote_target]))
    : {};
  const voteTallies = tally(players, room, settings);
  const voteCounts = settings.publicVotes && (room.phase === "voting" || room.phase === "runoff")
    ? Object.fromEntries(players.map((player) => [player.id, voteTallies.get(player.id) ?? 0]))
    : {};

  return {
    serverNow: now,
    room: {
      code: room.code,
      status: room.status,
      phase: room.phase,
      round: room.round,
      phaseEndsAt: room.phase_ends_at,
      turnSeat: room.turn_seat,
      seats: room.seats,
      settings,
      catastrophe: parse(room.catastrophe_json, null),
      bunker: parse(room.bunker_json, null),
      outside: parse(room.outside_json, null),
      runoff,
      log: parse<LogEntry[]>(room.log_json, []),
      outcome: room.status === "finished" ? outcome(players, room) : null,
      votes,
      voteCounts,
    },
    players: players.map((player) => {
      const allCards = parse<CharacterCard[]>(player.character_json, []);
      const revealed = revealedCategories(player);
      const abilityUsed = playerHasFlag(player, "@ability-used");
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        ready: Boolean(player.ready),
        active: Boolean(player.active),
        online: isBot(player) || now - player.last_seen < 20_000,
        isBot: isBot(player),
        isYou: player.id === viewer.id,
        revealed: allCards.filter((card) => revealed.includes(card.category)),
        character: room.status === "finished"
          ? allCards.filter((card) => card.category !== "special")
          : undefined,
        ability: abilityUsed ? allCards.find((card) => card.category === "special") : undefined,
        abilityUsed,
        hasVoted: player.vote_round === room.round && player.vote_phase === room.phase,
        protected: playerHasFlag(player, phaseFlag("immune", room)),
        doubleVote: hasActivatedDoubleVote(player, room),
      };
    }),
    you: {
      id: viewer.id,
      name: viewer.name,
      seat: viewer.seat,
      ready: Boolean(viewer.ready),
      active: Boolean(viewer.active),
      character: parse<CharacterCard[]>(viewer.character_json, []),
      revealed: revealedCategories(viewer),
      voteTarget:
        viewer.vote_round === room.round && viewer.vote_phase === room.phase ? viewer.vote_target : null,
      canManageBots: viewer.seat === 1,
      canControlPhases: viewer.seat === 1,
      abilityUsed: playerHasFlag(viewer, "@ability-used"),
    },
  };
}

async function createRoom(db: D1Database, body: Record<string, unknown>) {
  const settings = cleanSettings(body.settings);
  const now = Date.now();
  let code = makeCode();
  for (let attempt = 0; attempt < 5 && (await roomByCode(db, code)); attempt += 1) code = makeCode();
  const playerId = id(12);
  const token = id(24);
  await db.batch([
    db
      .prepare(
        `INSERT INTO rooms (code, status, settings_json, phase, round, seats, created_at, updated_at, log_json)
         VALUES (?, 'lobby', ?, 'lobby', 0, 0, ?, ?, ?)`,
      )
      .bind(code, JSON.stringify(settings), now, now, JSON.stringify([{ at: now, kind: "system", text: "Кімнату створено. Протокол очікує готовності групи." }])),
    db
      .prepare(
        `INSERT INTO players (id, room_code, name, token, seat, ready, active, last_seen)
         VALUES (?, ?, ?, ?, 1, 0, 1, ?)`,
      )
      .bind(playerId, code, cleanName(body.name) || "Гість 1", token, now),
  ]);
  return json({ ok: true, session: { code, playerId, token } }, 201);
}

async function joinRoom(db: D1Database, body: Record<string, unknown>) {
  const code = text(body.code).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const room = await roomByCode(db, code);
  if (!room) return json({ error: "Кімнату з таким кодом не знайдено." }, 404);
  if (room.status !== "lobby") return json({ error: "Ця експедиція вже розпочалася." }, 409);
  const settings = settingsFromRoom(room);
  const players = await playersByRoom(db, code);
  if (players.length >= settings.maxPlayers) return json({ error: "У кімнаті вже немає вільних місць." }, 409);
  const name = cleanName(body.name) || guestName(players);
  if (players.some((player) => player.name.toLocaleLowerCase("uk") === name.toLocaleLowerCase("uk"))) {
    return json({ error: "Це ім’я вже зайняте в кімнаті." }, 409);
  }
  const playerId = id(12);
  const token = id(24);
  const seat = Math.max(0, ...players.map((player) => player.seat)) + 1;
  await db
    .prepare(
      `INSERT INTO players (id, room_code, name, token, seat, ready, active, last_seen)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?)`,
    )
    .bind(playerId, code, name, token, seat, Date.now())
    .run();
  await appendLog(db, room, { kind: "system", text: `${name} приєднується до групи.` });
  return json({ ok: true, session: { code, playerId, token } }, 201);
}

async function applyActiveAbility(
  db: D1Database,
  room: RoomRow,
  player: PlayerRow,
  body: Record<string, unknown>,
): Promise<Response | null> {
  if (room.status !== "playing" || !player.active) {
    return json({ error: "Активну картку можна використати лише під час гри." }, 409);
  }
  if (playerHasFlag(player, "@ability-used")) {
    return json({ error: "Цю активну картку вже використано." }, 409);
  }

  const card = activeCard(player);
  const ability = card?.action as ActiveAbility | undefined;
  if (!card || !ability) return json({ error: "У вашому досьє немає активної картки." }, 404);

  const category = text(body.category);
  const players = await playersByRoom(db, room.code);
  const targetId = text(body.targetId);
  const target = players.find((item) => item.id === targetId && item.active && item.id !== player.id);
  const playerCards = parse<CharacterCard[]>(player.character_json, []);
  let logText = `${player.name} використовує активну картку «${card.value}».`;
  const requiresCategory = ["reroll_self", "swap", "expose", "scramble"].includes(ability);

  if (requiresCategory && (!isCharacterCategory(category) || category === "special")) {
    return json({ error: "Оберіть характеристику для дії активної картки." }, 400);
  }

  if (ability === "reroll_self") {
    const index = playerCards.findIndex((item) => item.category === category);
    if (index < 0) return json({ error: "Характеристику не знайдено." }, 404);
    if (!(await claimActiveAbility(db, player))) {
      return json({ error: "Цю активну картку вже використано." }, 409);
    }
    playerCards[index] = makeCard(category, playerCards[index]!.value);
    await db.prepare("UPDATE players SET character_json = ? WHERE id = ?").bind(JSON.stringify(playerCards), player.id).run();
    logText = `${player.name} оновлює власну характеристику «${playerCards[index]!.label}».`;
  } else if (ability === "swap") {
    if (!target) return json({ error: "Оберіть іншого активного гравця." }, 400);
    const targetCards = parse<CharacterCard[]>(target.character_json, []);
    const ownIndex = playerCards.findIndex((item) => item.category === category);
    const targetIndex = targetCards.findIndex((item) => item.category === category);
    if (ownIndex < 0 || targetIndex < 0) return json({ error: "Характеристику не знайдено." }, 404);
    if (!(await claimActiveAbility(db, player))) {
      return json({ error: "Цю активну картку вже використано." }, 409);
    }
    const ownCard = playerCards[ownIndex]!;
    playerCards[ownIndex] = { ...targetCards[targetIndex]!, category, label: ownCard.label };
    targetCards[targetIndex] = { ...ownCard, category, label: targetCards[targetIndex]!.label };
    await db.batch([
      db.prepare("UPDATE players SET character_json = ? WHERE id = ?").bind(JSON.stringify(playerCards), player.id),
      db.prepare("UPDATE players SET character_json = ? WHERE id = ?").bind(JSON.stringify(targetCards), target.id),
    ]);
    logText = `${player.name} та ${target.name} обмінюються характеристикою «${ownCard.label}».`;
  } else if (ability === "immunity") {
    if (!["voting", "runoff"].includes(room.phase)) {
      return json({ error: "Імунітет активується лише під час голосування." }, 409);
    }
    if (!(await claimActiveAbility(db, player, phaseFlag("immune", room)))) {
      return json({ error: "Цю активну картку вже використано." }, 409);
    }
    await appendLog(db, room, { kind: "ability", text: `${player.name} активує імунітет: один голос не буде враховано.` });
    return null;
  } else if (ability === "expose") {
    if (!target) return json({ error: "Оберіть іншого активного гравця." }, 400);
    if (revealedCategories(target).includes(category)) {
      return json({ error: "Ця характеристика гравця вже відкрита." }, 409);
    }
    if (!(await claimActiveAbility(db, player))) {
      return json({ error: "Цю активну картку вже використано." }, 409);
    }
    const stored = storedPlayerState(target);
    stored.push(category);
    await db.prepare("UPDATE players SET revealed_json = ? WHERE id = ?").bind(JSON.stringify(stored), target.id).run();
    const exposed = parse<CharacterCard[]>(target.character_json, []).find((item) => item.category === category);
    logText = `${player.name} відкриває картку ${target.name}: ${exposed?.label} — ${exposed?.value}.`;
  } else if (ability === "scramble") {
    if (!target) return json({ error: "Оберіть іншого активного гравця." }, 400);
    const targetCards = parse<CharacterCard[]>(target.character_json, []);
    const index = targetCards.findIndex((item) => item.category === category);
    if (index < 0) return json({ error: "Характеристику не знайдено." }, 404);
    if (!(await claimActiveAbility(db, player))) {
      return json({ error: "Цю активну картку вже використано." }, 409);
    }
    const previous = targetCards[index]!;
    targetCards[index] = makeCard(category, previous.value);
    await db.prepare("UPDATE players SET character_json = ? WHERE id = ?").bind(JSON.stringify(targetCards), target.id).run();
    logText = `${player.name} змінює характеристику «${previous.label}» у досьє ${target.name}.`;
  } else if (ability === "double_vote") {
    if (!["voting", "runoff"].includes(room.phase)) {
      return json({ error: "Подвійний голос активується лише під час голосування." }, 409);
    }
    if (!(await claimActiveAbility(db, player, phaseFlag("double-vote", room)))) {
      return json({ error: "Цю активну картку вже використано." }, 409);
    }
    await appendLog(db, room, { kind: "ability", text: `${player.name} активує подвійний голос.` });
    return null;
  }

  await appendLog(db, room, { kind: "ability", text: logText });
  return null;
}

async function handleAction(db: D1Database, body: Record<string, unknown>) {
  const code = text(body.code).toUpperCase();
  const playerId = text(body.playerId);
  const token = text(body.token);
  let room = await advanceGame(db, code);
  if (!room) return json({ error: "Кімнату не знайдено." }, 404);
  const player = await authenticatedPlayer(db, code, playerId, token);
  if (!player) return json({ error: "Сесію не підтверджено. Приєднайтеся до кімнати знову." }, 401);
  const action = text(body.action);

  if (action === "leave") {
    if (room.status === "lobby") {
      await db.prepare("DELETE FROM players WHERE id = ?").bind(player.id).run();
      const remaining = await playersByRoom(db, code);
      const remainingHumans = remaining.filter((item) => !isBot(item));
      if (!remainingHumans.length) {
        await db.prepare("DELETE FROM rooms WHERE code = ?").bind(code).run();
      } else {
        if (player.seat === 1) {
          const nextHost = remainingHumans[0]!;
          await db.prepare("UPDATE players SET seat = 1 WHERE id = ?").bind(nextHost.id).run();
        }
        await appendLog(db, room, { kind: "system", text: `${player.name} залишає кімнату.` });
      }
    }
    return json({ ok: true });
  } else if (action === "ready") {
    if (room.status !== "lobby") return json({ error: "Гра вже почалася." }, 409);
    await db.prepare("UPDATE players SET ready = ?, last_seen = ? WHERE id = ?").bind(body.ready ? 1 : 0, Date.now(), player.id).run();
    room = (await roomByCode(db, code))!;
    room = await maybeStart(db, room);
  } else if (action === "updateSettings") {
    if (room.status !== "lobby") return json({ error: "Правила можна змінювати лише до початку гри." }, 409);
    if (player.seat !== 1) return json({ error: "Змінювати правила може творець кімнати." }, 403);
    const players = await playersByRoom(db, code);
    const settings = cleanSettings(body.settings);
    if (settings.maxPlayers < players.length) {
      return json({ error: `У кімнаті вже ${players.length} учасників. Збільште ліміт гравців.` }, 400);
    }
    await db.batch([
      db.prepare("UPDATE rooms SET settings_json = ?, updated_at = ? WHERE code = ?").bind(JSON.stringify(settings), Date.now(), code),
      db.prepare("UPDATE players SET ready = 0 WHERE room_code = ? AND token NOT LIKE 'bot:%'").bind(code),
    ]);
    await appendLog(db, room, { kind: "system", text: "Творець кімнати оновив правила. Гравцям потрібно підтвердити готовність ще раз." });
  } else if (action === "addBots") {
    if (room.status !== "lobby") return json({ error: "Ботів можна додавати лише до початку гри." }, 409);
    if (player.seat !== 1) return json({ error: "Керувати ботами може творець кімнати." }, 403);
    const players = await playersByRoom(db, code);
    const settings = settingsFromRoom(room);
    const freeSeats = settings.maxPlayers - players.length;
    if (freeSeats <= 0) return json({ error: "У кімнаті вже немає вільних місць." }, 409);
    const count = clamp(body.count, 1, freeSeats, 1);
    const firstSeat = Math.max(0, ...players.map((item) => item.seat)) + 1;
    await db.batch(
      Array.from({ length: count }, (_, index) => {
        const botId = id(12);
        return db
          .prepare(
            `INSERT INTO players (id, room_code, name, token, seat, ready, active, last_seen)
             VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
          )
          .bind(botId, code, availableBotName(players, index), `bot:${id(16)}`, firstSeat + index, Date.now());
      }),
    );
    await appendLog(db, room, { kind: "system", text: count === 1 ? "До групи додано бота." : `До групи додано ботів: ${count}.` });
  } else if (action === "removeBot") {
    if (room.status !== "lobby") return json({ error: "Ботів можна прибирати лише до початку гри." }, 409);
    if (player.seat !== 1) return json({ error: "Керувати ботами може творець кімнати." }, 403);
    const botId = text(body.botId);
    const bot = (await playersByRoom(db, code)).find((item) => item.id === botId && isBot(item));
    if (!bot) return json({ error: "Бота не знайдено." }, 404);
    await db.prepare("DELETE FROM players WHERE id = ?").bind(bot.id).run();
    await appendLog(db, room, { kind: "system", text: `${bot.name} залишає групу.` });
  } else if (action === "reveal") {
    if (room.phase !== "reveal" || !player.active || player.seat !== room.turn_seat) {
      return json({ error: "Зараз не ваш хід відкривати характеристику." }, 409);
    }
    const selected = text(body.category);
    if (revealedCategories(player).length >= room.round) {
      return json({ error: "Картку вже відкрито. Тепер обговоріть її та передайте хід." }, 409);
    }
    if (revealedCategories(player).includes(selected)) return json({ error: "Цю характеристику вже відкрито." }, 409);
    await openCategory(db, room, player, selected);
  } else if (action === "passTurn") {
    if (room.phase !== "reveal") return json({ error: "Зараз немає ходу, який можна передати." }, 409);
    const players = await playersByRoom(db, code);
    const current = players.find((item) => item.active && item.seat === room!.turn_seat);
    if (!current) return json({ error: "Активного гравця не знайдено." }, 404);
    const isCurrentPlayer = current.id === player.id;
    if (!isCurrentPlayer && player.seat !== 1) return json({ error: "Передати цей хід може активний гравець або творець кімнати." }, 403);
    if (revealedCategories(current).length < room.round) {
      if (isCurrentPlayer) return json({ error: "Спочатку відкрийте одну характеристику." }, 409);
      await openCategory(db, room, current);
    }
    await moveRevealTurn(db, room);
  } else if (action === "advancePhase") {
    if (player.seat !== 1) return json({ error: "Керувати ручними фазами може творець кімнати." }, 403);
    if (room.phase === "briefing") await beginReveal(db, room);
    else if (room.phase === "discussion") await beginVoting(db, room);
    else if (room.phase === "voting" || room.phase === "runoff") await resolveVote(db, room);
    else return json({ error: "Цю фазу не можна завершити вручну." }, 409);
  } else if (action === "useAbility") {
    const errorResponse = await applyActiveAbility(db, room, player, body);
    if (errorResponse) return errorResponse;
  } else if (action === "vote") {
    const settings = settingsFromRoom(room);
    if (room.round === 1 || !["voting", "runoff"].includes(room.phase) || (!player.active && !settings.excludedCanVote)) {
      return json({ error: "Зараз голосування недоступне." }, 409);
    }
    if (player.vote_round === room.round && player.vote_phase === room.phase) {
      return json({ error: "Ви вже проголосували в цьому раунді." }, 409);
    }
    const targetId = text(body.targetId);
    const players = await playersByRoom(db, code);
    const target = players.find((item) => item.id === targetId && item.active);
    if (!target || target.id === player.id) return json({ error: "Оберіть іншого активного гравця." }, 400);
    const runoff = parse<string[]>(room.runoff_json, []);
    if (room.phase === "runoff" && !runoff.includes(target.id)) return json({ error: "У переголосуванні доступні лише кандидати з нічиєю." }, 400);
    const voteResult = await db
      .prepare(
        `UPDATE players
         SET vote_target = ?, vote_round = ?, vote_phase = ?, last_seen = ?
         WHERE id = ?
           AND (vote_round IS NULL OR vote_phase IS NULL OR vote_round != ? OR vote_phase != ?)`,
      )
      .bind(target.id, room.round, room.phase, Date.now(), player.id, room.round, room.phase)
      .run();
    if (!voteResult.meta.changes) {
      return json({ error: "Ви вже проголосували в цьому раунді." }, 409);
    }
    const refreshedPlayers = await playersByRoom(db, code);
    const required = eligibleVoters(refreshedPlayers, settings);
    if (required.every((item) => item.vote_round === room!.round && item.vote_phase === room!.phase)) {
      await resolveVote(db, room);
    }
  } else if (action === "heartbeat") {
    await db.prepare("UPDATE players SET last_seen = ? WHERE id = ?").bind(Date.now(), player.id).run();
  } else {
    return json({ error: "Невідома дія." }, 400);
  }

  room = (await advanceGame(db, code))!;
  const viewer = (await authenticatedPlayer(db, code, playerId, token))!;
  return json({ ok: true, state: await publicState(db, room, viewer) });
}

export async function handleGameApi(request: Request, env: Env) {
  if (!env.DB) return json({ error: "База даних гри ще не підключена." }, 503);
  await ensureSchema(env.DB);
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const code = (url.searchParams.get("code") ?? "").toUpperCase();
      const playerId = request.headers.get("X-Player-Id") ?? url.searchParams.get("playerId") ?? "";
      const authorization = request.headers.get("Authorization") ?? "";
      const token = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : url.searchParams.get("token") ?? "";
      const room = await advanceGame(env.DB, code);
      if (!room) return json({ error: "Кімнату не знайдено." }, 404);
      const player = await authenticatedPlayer(env.DB, code, playerId, token);
      if (!player) return json({ error: "Сесію не підтверджено." }, 401);
      await env.DB.prepare("UPDATE players SET last_seen = ? WHERE id = ?").bind(Date.now(), player.id).run();
      return json({ ok: true, state: await publicState(env.DB, room, { ...player, last_seen: Date.now() }) });
    }

    if (request.method === "POST") {
      const body = (await request.json()) as Record<string, unknown>;
      if (body.action === "create") return createRoom(env.DB, body);
      if (body.action === "join") return joinRoom(env.DB, body);
      return handleAction(env.DB, body);
    }
    return json({ error: "Метод не підтримується." }, 405);
  } catch (error) {
    console.error("game-api", error);
    return json({ error: "Сервер не зміг обробити дію. Спробуйте ще раз." }, 500);
  }
}
