export type ActiveAbility =
  | "reroll_self"
  | "swap"
  | "immunity"
  | "expose"
  | "scramble"
  | "double_vote";

export type CharacterCategory =
  | "profession"
  | "health"
  | "biology"
  | "phobia"
  | "hobby"
  | "trait"
  | "fact"
  | "baggage"
  | "special";

export type Card = {
  category: string;
  label: string;
  value: string;
  note: string;
  tone: "good" | "mixed" | "risk";
  action?: ActiveAbility;
};

export type Scenario = {
  title: string;
  description: string;
  facts: string[];
};

export type RoomSettings = {
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

export type Player = {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
  active: boolean;
  online: boolean;
  isBot: boolean;
  isYou: boolean;
  revealed: Card[];
  character?: Card[];
  ability?: Card;
  abilityUsed: boolean;
  hasVoted: boolean;
  protected: boolean;
  doubleVote: boolean;
};

export type GameState = {
  serverNow: number;
  room: {
    code: string;
    status: "lobby" | "playing" | "finished";
    phase: string;
    round: number;
    phaseEndsAt: number | null;
    turnSeat: number | null;
    seats: number;
    settings: RoomSettings;
    catastrophe: Scenario | null;
    bunker: Scenario | null;
    outside: Scenario | null;
    runoff: string[];
    log: { at: number; kind: string; text: string }[];
    outcome: {
      score: number;
      title: string;
      summary: string;
      legacyReady: boolean;
      victoryRule: string;
    } | null;
    votes: Record<string, string>;
    voteCounts: Record<string, number>;
  };
  players: Player[];
  you: {
    id: string;
    name: string;
    seat: number;
    ready: boolean;
    active: boolean;
    character: Card[];
    revealed: string[];
    voteTarget: string | null;
    canManageBots: boolean;
    canControlPhases: boolean;
    abilityUsed: boolean;
  };
};

export type Session = { code: string; playerId: string; token: string };

export type SiteTheme = "command" | "ember" | "biosphere";

export type LogEntry = {
  at: number;
  kind: "system" | "reveal" | "vote" | "ability";
  text: string;
};