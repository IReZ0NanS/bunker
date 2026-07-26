import {
  bunkers,
  catastrophes,
  categoryOrder,
  makeCharacter,
  outsideWorlds,
  pick,
  worldEvents,
  type CharacterCard,
  type WorldEvent,
} from "./game-data";

type Env = { DB: D1Database };

type Settings = {
  minPlayers: number;
  maxPlayers: number;
  seatsPercent: number;
  revealSeconds: number;
  discussionSeconds: number;
  votingSeconds: number;
  publicVotes: boolean;
  excludedCanVote: boolean;
  eventFrequency: "each" | "alternate";
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
  kind: "system" | "reveal" | "vote" | "event";
  text: string;
};

const defaultSettings: Settings = {
  minPlayers: 4,
  maxPlayers: 8,
  seatsPercent: 50,
  revealSeconds: 35,
  discussionSeconds: 75,
  votingSeconds: 45,
  publicVotes: false,
  excludedCanVote: false,
  eventFrequency: "each",
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

function cleanName(value: unknown) {
  return text(value, "Гравець").replace(/[<>]/g, "").slice(0, 24) || "Гравець";
}

function cleanSettings(input: unknown): Settings {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const maxPlayers = clamp(source.maxPlayers, 4, 12, defaultSettings.maxPlayers);
  const minPlayers = clamp(source.minPlayers, 4, maxPlayers, Math.min(defaultSettings.minPlayers, maxPlayers));
  return {
    minPlayers,
    maxPlayers,
    seatsPercent: clamp(source.seatsPercent, 40, 60, defaultSettings.seatsPercent),
    revealSeconds: clamp(source.revealSeconds, 20, 90, defaultSettings.revealSeconds),
    discussionSeconds: clamp(source.discussionSeconds, 30, 180, defaultSettings.discussionSeconds),
    votingSeconds: clamp(source.votingSeconds, 20, 90, defaultSettings.votingSeconds),
    publicVotes: Boolean(source.publicVotes),
    excludedCanVote: Boolean(source.excludedCanVote),
    eventFrequency: source.eventFrequency === "alternate" ? "alternate" : "each",
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
  const settings = parse<Settings>(room.settings_json, defaultSettings);
  const players = await playersByRoom(db, room.code);
  if (players.length < settings.minPlayers || players.some((player) => !player.ready)) return room;

  const now = Date.now();
  const seats = Math.max(2, Math.floor((players.length * settings.seatsPercent) / 100));
  const assignments = players.map((player) =>
    db
      .prepare("UPDATE players SET character_json = ?, revealed_json = '[]', active = 1 WHERE id = ?")
      .bind(JSON.stringify(makeCharacter()), player.id),
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
      now + 18_000,
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

function revealedCategories(player: PlayerRow) {
  return parse<string[]>(player.revealed_json, []);
}

async function openCategory(db: D1Database, room: RoomRow, player: PlayerRow, category?: string) {
  const cards = parse<CharacterCard[]>(player.character_json, []);
  const revealed = revealedCategories(player);
  let selected = category;
  if (room.round === 1) selected = "profession";
  if (!selected || !categoryOrder.includes(selected as (typeof categoryOrder)[number]) || revealed.includes(selected)) {
    selected = categoryOrder.find((item) => !revealed.includes(item));
  }
  if (!selected) return;
  revealed.push(selected);
  await db.prepare("UPDATE players SET revealed_json = ? WHERE id = ?").bind(JSON.stringify(revealed), player.id).run();
  const card = cards.find((item) => item.category === selected);
  await appendLog(db, room, {
    kind: "reveal",
    text: `${player.name} відкриває: ${card?.label ?? selected} — ${card?.value ?? "невідомо"}.`,
  });
}

async function beginReveal(db: D1Database, room: RoomRow) {
  const settings = parse<Settings>(room.settings_json, defaultSettings);
  const players = (await playersByRoom(db, room.code)).filter((player) => player.active);
  const first = players[0];
  if (!first) return;
  await db
    .prepare("UPDATE rooms SET phase = 'reveal', turn_seat = ?, phase_ends_at = ?, updated_at = ? WHERE code = ?")
    .bind(first.seat, Date.now() + settings.revealSeconds * 1000, Date.now(), room.code)
    .run();
}

async function moveRevealTurn(db: D1Database, room: RoomRow) {
  const settings = parse<Settings>(room.settings_json, defaultSettings);
  const players = (await playersByRoom(db, room.code)).filter((player) => player.active);
  const pending = players.filter((player) => revealedCategories(player).length < room.round);
  if (!pending.length) {
    await db
      .prepare("UPDATE rooms SET phase = 'discussion', turn_seat = NULL, phase_ends_at = ?, updated_at = ? WHERE code = ?")
      .bind(Date.now() + settings.discussionSeconds * 1000, Date.now(), room.code)
      .run();
    await appendLog(db, room, { kind: "system", text: "Відкрита загальна дискусія." });
    return;
  }
  const next = pending.find((player) => player.seat > (room.turn_seat ?? 0)) ?? pending[0]!;
  await db
    .prepare("UPDATE rooms SET turn_seat = ?, phase_ends_at = ?, updated_at = ? WHERE code = ?")
    .bind(next.seat, Date.now() + settings.revealSeconds * 1000, Date.now(), room.code)
    .run();
}

function eligibleVoters(players: PlayerRow[], settings: Settings) {
  return settings.excludedCanVote ? players : players.filter((player) => player.active);
}

async function beginVoting(db: D1Database, room: RoomRow) {
  const settings = parse<Settings>(room.settings_json, defaultSettings);
  await db.batch([
    db.prepare("UPDATE players SET vote_target = NULL, vote_round = NULL, vote_phase = NULL WHERE room_code = ?").bind(room.code),
    db
      .prepare("UPDATE rooms SET phase = 'voting', phase_ends_at = ?, runoff_json = NULL, updated_at = ? WHERE code = ?")
      .bind(Date.now() + settings.votingSeconds * 1000, Date.now(), room.code),
  ]);
  await appendLog(db, room, { kind: "system", text: "Голосування відкрито." });
}

function tally(players: PlayerRow[], room: RoomRow, settings: Settings) {
  const allowed = new Set(eligibleVoters(players, settings).map((player) => player.id));
  const counts = new Map<string, number>();
  for (const player of players) {
    if (!allowed.has(player.id) || player.vote_round !== room.round || player.vote_phase !== room.phase || !player.vote_target) continue;
    counts.set(player.vote_target, (counts.get(player.vote_target) ?? 0) + 1);
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

  const settings = parse<Settings>(room.settings_json, defaultSettings);
  const showEvent = settings.eventFrequency === "each" || room.round % 2 === 1;
  if (showEvent) {
    const event = pick(worldEvents);
    await db
      .prepare("UPDATE rooms SET phase = 'event', current_event_json = ?, phase_ends_at = ?, runoff_json = NULL, updated_at = ? WHERE code = ?")
      .bind(JSON.stringify(event), Date.now() + 14_000, Date.now(), room.code)
      .run();
    await appendLog(db, room, { kind: "event", text: `${event.zone}: ${event.title}.` });
  } else {
    await nextRound(db, room);
  }
}

async function resolveVote(db: D1Database, room: RoomRow) {
  const settings = parse<Settings>(room.settings_json, defaultSettings);
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
        .bind(JSON.stringify(tiedIds), Date.now() + Math.max(20, Math.floor(settings.votingSeconds * 0.7)) * 1000, Date.now(), room.code),
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
    const now = Date.now();
    if (!room.phase_ends_at || now < room.phase_ends_at) break;

    if (room.phase === "briefing") {
      await beginReveal(db, room);
    } else if (room.phase === "reveal") {
      const players = await playersByRoom(db, code);
      const current = players.find((player) => player.active && player.seat === room!.turn_seat);
      if (current) await openCategory(db, room, current);
      await moveRevealTurn(db, room);
    } else if (room.phase === "discussion") {
      await beginVoting(db, room);
    } else if (room.phase === "voting" || room.phase === "runoff") {
      await resolveVote(db, room);
    } else if (room.phase === "event") {
      await nextRound(db, room);
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
  const settings = parse<Settings>(room.settings_json, defaultSettings);
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
  const settings = parse<Settings>(room.settings_json, defaultSettings);
  const now = Date.now();
  const runoff = parse<string[]>(room.runoff_json, []);
  const votes = settings.publicVotes && (room.phase === "voting" || room.phase === "runoff")
    ? Object.fromEntries(players.filter((player) => player.vote_target).map((player) => [player.id, player.vote_target]))
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
      currentEvent: parse<WorldEvent | null>(room.current_event_json, null),
      runoff,
      log: parse<LogEntry[]>(room.log_json, []),
      outcome: room.status === "finished" ? outcome(players, room) : null,
      votes,
    },
    players: players.map((player) => {
      const allCards = parse<CharacterCard[]>(player.character_json, []);
      const revealed = revealedCategories(player);
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        ready: Boolean(player.ready),
        active: Boolean(player.active),
        online: now - player.last_seen < 20_000,
        isYou: player.id === viewer.id,
        revealed: allCards.filter((card) => revealed.includes(card.category)),
        character: room.status === "finished" ? allCards : undefined,
        hasVoted: player.vote_round === room.round && player.vote_phase === room.phase,
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
      .bind(playerId, code, cleanName(body.name), token, now),
  ]);
  return json({ ok: true, session: { code, playerId, token } }, 201);
}

async function joinRoom(db: D1Database, body: Record<string, unknown>) {
  const code = text(body.code).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const room = await roomByCode(db, code);
  if (!room) return json({ error: "Кімнату з таким кодом не знайдено." }, 404);
  if (room.status !== "lobby") return json({ error: "Ця експедиція вже розпочалася." }, 409);
  const settings = parse<Settings>(room.settings_json, defaultSettings);
  const players = await playersByRoom(db, code);
  if (players.length >= settings.maxPlayers) return json({ error: "У кімнаті вже немає вільних місць." }, 409);
  const name = cleanName(body.name);
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

async function handleAction(db: D1Database, body: Record<string, unknown>) {
  const code = text(body.code).toUpperCase();
  const playerId = text(body.playerId);
  const token = text(body.token);
  let room = await advanceGame(db, code);
  if (!room) return json({ error: "Кімнату не знайдено." }, 404);
  const player = await authenticatedPlayer(db, code, playerId, token);
  if (!player) return json({ error: "Сесію не підтверджено. Приєднайтеся до кімнати знову." }, 401);
  const action = text(body.action);

  if (action === "ready") {
    if (room.status !== "lobby") return json({ error: "Гра вже почалася." }, 409);
    await db.prepare("UPDATE players SET ready = ?, last_seen = ? WHERE id = ?").bind(body.ready ? 1 : 0, Date.now(), player.id).run();
    room = (await roomByCode(db, code))!;
    room = await maybeStart(db, room);
  } else if (action === "reveal") {
    if (room.phase !== "reveal" || !player.active || player.seat !== room.turn_seat) {
      return json({ error: "Зараз не ваш хід відкривати характеристику." }, 409);
    }
    const selected = text(body.category);
    if (room.round === 1 && selected && selected !== "profession") {
      return json({ error: "У першому раунді обов’язково відкривається професія." }, 409);
    }
    if (revealedCategories(player).includes(selected)) return json({ error: "Цю характеристику вже відкрито." }, 409);
    await openCategory(db, room, player, selected);
    await moveRevealTurn(db, room);
  } else if (action === "vote") {
    const settings = parse<Settings>(room.settings_json, defaultSettings);
    if (!["voting", "runoff"].includes(room.phase) || (!player.active && !settings.excludedCanVote)) {
      return json({ error: "Зараз голосування недоступне." }, 409);
    }
    const targetId = text(body.targetId);
    const players = await playersByRoom(db, code);
    const target = players.find((item) => item.id === targetId && item.active);
    if (!target || target.id === player.id) return json({ error: "Оберіть іншого активного гравця." }, 400);
    const runoff = parse<string[]>(room.runoff_json, []);
    if (room.phase === "runoff" && !runoff.includes(target.id)) return json({ error: "У переголосуванні доступні лише кандидати з нічиєю." }, 400);
    await db
      .prepare("UPDATE players SET vote_target = ?, vote_round = ?, vote_phase = ?, last_seen = ? WHERE id = ?")
      .bind(target.id, room.round, room.phase, Date.now(), player.id)
      .run();
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
      const playerId = url.searchParams.get("playerId") ?? "";
      const token = url.searchParams.get("token") ?? "";
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
