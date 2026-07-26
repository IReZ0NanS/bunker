import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  status: text("status").notNull().default("lobby"),
  settingsJson: text("settings_json").notNull(),
  phase: text("phase").notNull().default("lobby"),
  round: integer("round").notNull().default(0),
  phaseEndsAt: integer("phase_ends_at"),
  turnSeat: integer("turn_seat"),
  catastropheJson: text("catastrophe_json"),
  bunkerJson: text("bunker_json"),
  outsideJson: text("outside_json"),
  currentEventJson: text("current_event_json"),
  runoffJson: text("runoff_json"),
  seats: integer("seats").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  logJson: text("log_json").notNull().default("[]"),
});

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    name: text("name").notNull(),
    token: text("token").notNull(),
    seat: integer("seat").notNull(),
    ready: integer("ready").notNull().default(0),
    active: integer("active").notNull().default(1),
    lastSeen: integer("last_seen").notNull(),
    characterJson: text("character_json").notNull().default("[]"),
    revealedJson: text("revealed_json").notNull().default("[]"),
    voteTarget: text("vote_target"),
    voteRound: integer("vote_round"),
    votePhase: text("vote_phase"),
  },
  (table) => [index("players_room_idx").on(table.roomCode, table.seat)],
);
