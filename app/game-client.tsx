"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";

type Session = { code: string; playerId: string; token: string };
type Card = {
  category: string;
  label: string;
  value: string;
  note: string;
  tone: "good" | "mixed" | "risk";
  action?: "reroll_self" | "swap" | "immunity" | "expose" | "scramble" | "double_vote";
};
type Scenario = { title: string; description: string; facts: string[] };
type RoomSettings = {
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
type Player = {
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
type GameState = {
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
    outcome: { score: number; title: string; summary: string; legacyReady: boolean; victoryRule: string } | null;
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

const sessionKey = "bunker-protocol-session";

const phaseCopy: Record<string, { eyebrow: string; title: string; hint: string }> = {
  briefing: { eyebrow: "Вхідні дані", title: "Оцініть загрозу", hint: "Система готує досьє та відкриває умови експедиції." },
  reveal: { eyebrow: "Особисті досьє", title: "Відкриття характеристик", hint: "Активний гравець обирає одну карту й аргументує її користь." },
  discussion: { eyebrow: "Спільний канал", title: "Відкрита дискусія", hint: "Порівняйте ризики, прогалини та комбінації навичок." },
  voting: { eyebrow: "Рішення групи", title: "Таємне голосування", hint: "Оберіть людину, без якої група має найбільші шанси." },
  runoff: { eyebrow: "Нічия", title: "Переголосування", hint: "Вибір обмежено кандидатами з однаковим результатом." },
  finished: { eyebrow: "Протокол завершено", title: "Шлюз зачинено", hint: "Система оцінила фінальний склад експедиції." },
};

const timeOptions = {
  reveal: [0, 30, 60, 90, 120, 180, 300],
  discussion: [0, 60, 120, 180, 300, 420, 600],
  voting: [0, 30, 45, 60, 90, 120, 180, 300],
};

const categoryNames: Record<string, string> = {
  profession: "Професія",
  health: "Здоров’я",
  biology: "Біологія",
  phobia: "Фобія",
  hobby: "Хобі",
  trait: "Характер",
  fact: "Факт",
  baggage: "Багаж",
};
const profileCategories = Object.entries(categoryNames);

function InfoTooltip({ label, text }: { label: string; text: string }) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open]);
  return (
    <button
      type="button"
      className={`term-help ${open ? "open" : ""}`}
      aria-label={`Пояснення терміна «${label}»`}
      aria-describedby={tooltipId}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen(true)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          event.currentTarget.blur();
        }
      }}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M10 9.2v4.1M10 6.7h.01" />
      </svg>
      <span id={tooltipId} className="term-tooltip" role="tooltip">
        <strong>{label}</strong>
        {text}
      </span>
    </button>
  );
}

function CharacteristicIcon({ category }: { category: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg className="profile-icon" viewBox="0 0 24 24" aria-hidden="true">
      {category === "profession" && <><path {...common} d="M4 8.5h16v10H4zM9 8.5V6h6v2.5M4 12h16M10 12v2h4v-2" /></>}
      {category === "health" && <><path {...common} d="M12 20S4.5 15.7 4.5 9.7A4.2 4.2 0 0 1 12 7.1a4.2 4.2 0 0 1 7.5 2.6C19.5 15.7 12 20 12 20Z" /><path {...common} d="M8 12h2.4l1.1-2.3 1.6 4.5 1-2.2H16" /></>}
      {category === "biology" && <><path {...common} d="M8 4c0 4 8 4 8 8s-8 4-8 8M16 4c0 4-8 4-8 8s8 4 8 8M9 7h6M9 12h6M9 17h6" /></>}
      {category === "phobia" && <><path {...common} d="M12 3 3.8 19h16.4L12 3Z" /><path {...common} d="M12 9v4.5M12 17h.01" /></>}
      {category === "hobby" && <><path {...common} d="M7.5 8.5h9A4.5 4.5 0 0 1 21 13v2a2.5 2.5 0 0 1-4.5 1.5L15 14H9l-1.5 2.5A2.5 2.5 0 0 1 3 15v-2a4.5 4.5 0 0 1 4.5-4.5Z" /><path {...common} d="M7 11v4M5 13h4M16.5 12h.01M18.5 14h.01" /></>}
      {category === "trait" && <><circle {...common} cx="12" cy="12" r="8" /><path {...common} d="M9 10h.01M15 10h.01M8.5 14.5c1 1 2.1 1.5 3.5 1.5s2.5-.5 3.5-1.5" /></>}
      {category === "fact" && <><circle {...common} cx="12" cy="12" r="8" /><path {...common} d="M12 11v5M12 8h.01" /></>}
      {category === "baggage" && <><path {...common} d="M5 8h14v11H5zM9 8V5h6v3M5 12h14M11 12v2h2v-2" /></>}
    </svg>
  );
}

function durationLabel(seconds: number) {
  if (seconds === 0) return "Без обмеження";
  if (seconds < 60) return `${seconds} с`;
  return seconds % 60 === 0 ? `${seconds / 60} хв` : `${Math.floor(seconds / 60)} хв ${seconds % 60} с`;
}

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function gameStateFingerprint(state: GameState) {
  return JSON.stringify({
    room: state.room,
    players: state.players,
    you: state.you,
  });
}

function Logo({ onHome }: { onHome?: () => void }) {
  const content = (
    <>
      <span className="brand-mark"><i /></span>
      <span>
        <strong>Бункер</strong>
        <small>Протокол виживання</small>
      </span>
    </>
  );
  return onHome ? (
    <button type="button" className="brand brand-home-button" aria-label="На головний екран" onClick={onHome}>
      {content}
    </button>
  ) : <div className="brand" aria-label="Бункер: Протокол">{content}</div>;
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="toggle-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

function TimeSelect({
  label,
  description,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  options: number[];
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="time-select">
      <span><strong>{label}</strong><small>{description}</small></span>
      <select disabled={disabled} value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((seconds) => <option key={seconds} value={seconds}>{durationLabel(seconds)}</option>)}
      </select>
    </label>
  );
}

function Landing({
  busy,
  error,
  initialCode,
  activeGame,
  onCreate,
  onJoin,
  onResume,
}: {
  busy: boolean;
  error: string;
  initialCode: string;
  activeGame?: { code: string; status?: GameState["room"]["status"]; round?: number };
  onCreate: (payload: Record<string, unknown>) => void;
  onJoin: (payload: Record<string, unknown>) => void;
  onResume: () => void;
}) {
  const [tab, setTab] = useState<"create" | "join">(initialCode ? "join" : "create");
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [advanced, setAdvanced] = useState(false);
  const [settings, setSettings] = useState({
    minPlayers: 8,
    maxPlayers: 8,
    seatsCount: 4,
    revealSeconds: 0,
    discussionSeconds: 0,
    votingSeconds: 0,
    publicVotes: true,
    excludedCanVote: false,
    victoryRule: "survival",
  });

  const update = (key: string, value: string | number | boolean) =>
    setSettings((current) => ({ ...current, [key]: value }));
  const updatePlayerCount = (value: number) => {
    const playerCount = Math.min(12, Math.max(4, value));
    setSettings((current) => ({
      ...current,
      minPlayers: playerCount,
      maxPlayers: playerCount,
      seatsCount: Math.min(current.seatsCount, playerCount - 1),
    }));
  };

  return (
    <main className="landing-shell">
      <div className="landing-noise" />
      <header className="landing-header">
        <Logo />
        <div className="system-status"><span /> Система онлайн</div>
      </header>
      <section className="landing-copy">
        <div className="kicker"><span>01</span> Автономна соціальна гра</div>
        <h1>Місць менше,<br />ніж людей.</h1>
        <p>
          Відкривайте досьє, переконуйте групу та вирішуйте, хто переживе катастрофу.
          Без ведучого — систему контролює сервер.
        </p>
        <div className="feature-strip">
          <div><b>4–12</b><span>гравців</span></div>
          <div><b>∞</b><span>режим без таймерів</span></div>
          <div><b>∞</b><span>сценаріїв</span></div>
        </div>
      </section>

      <section className="entry-panel" aria-label="Створити або приєднатися до гри">
        {activeGame && (
          <div className="resume-game-card">
            <span>
              <small>{activeGame.status === "lobby" ? "Активна кімната" : activeGame.status === "finished" ? "Завершена експедиція" : "Гра триває"}</small>
              <strong>{activeGame.code}{activeGame.round ? ` · раунд ${String(activeGame.round).padStart(2, "0")}` : ""}</strong>
            </span>
            <button type="button" onClick={onResume}>Повернутися до гри →</button>
          </div>
        )}
        <div className="guest-badge"><span>✓</span> Гостьовий вхід без реєстрації</div>
        <div className="entry-tabs">
          <button className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>Нова кімната</button>
          <button className={tab === "join" ? "active" : ""} onClick={() => setTab("join")}>Увійти за кодом</button>
        </div>

        <div className="field">
          <label htmlFor="player-name">Ваше ім’я <span className="optional-label">необов’язково</span></label>
          <input id="player-name" maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="Залиште порожнім — дамо гостьове ім’я" autoComplete="nickname" />
        </div>

        {tab === "join" ? (
          <div className="field">
            <label htmlFor="room-code">Код кімнати</label>
            <input
              id="room-code"
              className="code-input"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="A7K9P2"
              autoCapitalize="characters"
            />
          </div>
        ) : (
          <>
            <div className="compact-settings">
              <label>
                <span>Учасників у грі</span>
                <input type="number" min={4} max={12} step={1} inputMode="numeric" value={settings.maxPlayers} onChange={(event) => updatePlayerCount(Number(event.target.value))} />
                <small>Від 4 до 12</small>
              </label>
              <label>
                <span>Залишаться в бункері</span>
                <input type="number" min={2} max={settings.maxPlayers - 1} step={1} inputMode="numeric" value={settings.seatsCount} onChange={(event) => update("seatsCount", Math.min(settings.maxPlayers - 1, Math.max(2, Number(event.target.value))))} />
                <small>Від 2 до {settings.maxPlayers - 1}</small>
              </label>
            </div>
            <button className="advanced-button" onClick={() => setAdvanced((value) => !value)}>
              <span>Налаштування протоколу</span><i className={advanced ? "open" : ""}>⌄</i>
            </button>
            {advanced && (
              <div className="advanced-settings">
                <div className="unlimited-preset">
                  <span><strong>Розмовляйте досхочу</strong><small>Рекомендовано для гри без поспіху</small></span>
                  <button onClick={() => setSettings((current) => ({ ...current, revealSeconds: 0, discussionSeconds: 0, votingSeconds: 0 }))}>Без таймерів</button>
                </div>
                <TimeSelect label="Хід і розповідь" description="Час на картку та аргументи" value={settings.revealSeconds} options={timeOptions.reveal} onChange={(value) => update("revealSeconds", value)} />
                <TimeSelect label="Загальна дискусія" description="Обговорення після кола" value={settings.discussionSeconds} options={timeOptions.discussion} onChange={(value) => update("discussionSeconds", value)} />
                <TimeSelect label="Голосування" description="Час на фінальний вибір" value={settings.votingSeconds} options={timeOptions.voting} onChange={(value) => update("votingSeconds", value)} />
                <Toggle checked={settings.publicVotes} onChange={(value) => update("publicVotes", value)} label="Відкрите голосування" description="Показувати кількість голосів на картках" />
                <Toggle checked={settings.excludedCanVote} onChange={(value) => update("excludedCanVote", value)} label="Голос вигнаних" description="Виключені зберігають вплив" />
                <label className="select-row">
                  <span><strong>Умови перемоги</strong><small>Що враховує фінальний аналіз</small></span>
                  <select value={settings.victoryRule} onChange={(event) => update("victoryRule", event.target.value)}>
                    <option value="survival">Виживання</option>
                    <option value="legacy">Спадкоємність</option>
                  </select>
                </label>
              </div>
            )}
          </>
        )}

        {error && <div className="error-note" role="alert">{error}</div>}
        <button
          className="primary-button"
          disabled={busy || (tab === "join" && code.length !== 6)}
          onClick={() => tab === "create" ? onCreate({ name, settings }) : onJoin({ name, code })}
        >
          {busy ? "Встановлюємо зв’язок…" : tab === "create" ? "Увійти гостем і створити гру" : "Увійти гостем до кімнати"}
          <span>→</span>
        </button>
        <p className="privacy-note">Жодних акаунтів чи паролів. Приватне досьє зберігається лише у вашому браузері.</p>
      </section>
      <footer className="landing-footer"><span>Оригінальна онлайн-гра за мотивами жанру соціального виживання</span><b>UA · v1.0</b></footer>
    </main>
  );
}

function Lobby({
  state,
  busy,
  onReady,
  onAddBots,
  onRemoveBot,
  onUpdateSettings,
  onHome,
  onLeave,
}: {
  state: GameState;
  busy: boolean;
  onReady: (ready: boolean) => void;
  onAddBots: (count: number) => void;
  onRemoveBot: (botId: string) => void;
  onUpdateSettings: (settings: RoomSettings) => void;
  onHome: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<RoomSettings>(state.room.settings);
  const readyCount = state.players.filter((player) => player.ready).length;
  const botCount = state.players.filter((player) => player.isBot).length;
  const missingForStart = Math.max(0, state.room.settings.minPlayers - state.players.length);
  const hasFreeSeats = state.players.length < state.room.settings.maxPlayers;
  const settingsChanged = JSON.stringify(draft) !== JSON.stringify(state.room.settings);
  const updateDraft = <K extends keyof RoomSettings>(key: K, value: RoomSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const updateDraftPlayerCount = (value: number) => {
    const playerCount = Math.min(12, Math.max(4, value));
    setDraft((current) => ({
      ...current,
      minPlayers: playerCount,
      maxPlayers: playerCount,
      seatsCount: Math.min(current.seatsCount, playerCount - 1),
    }));
  };
  const copyInvite = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", state.room.code);
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <main className="lobby-shell">
      <header className="game-header">
        <Logo onHome={onHome} />
        <button className="quiet-button" onClick={onLeave}>Вийти</button>
      </header>
      <section className="lobby-intro">
        <div className="kicker"><span>02</span> Збір групи</div>
        <h1>Зберіть групу й узгодьте правила</h1>
        <p>Запросіть друзів або додайте ботів. До старту творець кімнати може змінити таймери, правила голосування та кількість місць.</p>
      </section>
      <section className="invite-card">
        <div><small>Код доступу</small><strong>{state.room.code}</strong></div>
        <button onClick={copyInvite}>{copied ? "Посилання скопійовано" : "Скопіювати запрошення"}</button>
      </section>
      <div className="lobby-grid">
        <section className="crew-panel">
          <div className="panel-heading">
            <span><small>Учасники</small><strong>{state.players.length} / {state.room.settings.maxPlayers}</strong></span>
            <em>{readyCount} готові</em>
          </div>
          <div className="crew-list">
            {state.players.map((player) => (
              <div className="crew-row" key={player.id}>
                <span className="seat-number">{String(player.seat).padStart(2, "0")}</span>
                <span className={`avatar ${player.isBot ? "bot-avatar" : ""}`}>{player.isBot ? "AI" : player.name.slice(0, 1).toUpperCase()}</span>
                <span className="crew-name">
                  <strong>{player.name}{player.isYou ? " · ви" : ""}{player.isBot ? " · бот" : ""}</strong>
                  <small>{player.isBot ? "автономний гравець" : player.online ? "на зв’язку" : "перепідключення…"}</small>
                </span>
                {player.isBot && state.you.canManageBots ? (
                  <button className="remove-bot" disabled={busy} onClick={() => onRemoveBot(player.id)} aria-label={`Прибрати бота ${player.name}`}>×</button>
                ) : null}
                <span className={`ready-badge ${player.ready ? "ready" : ""}`}>{player.ready ? "Готовий" : "Очікує"}</span>
              </div>
            ))}
            {Array.from({ length: Math.max(0, state.room.settings.minPlayers - state.players.length) }).map((_, index) => (
              <div className="crew-row empty" key={`empty-${index}`}>
                <span className="seat-number">—</span><span className="avatar">+</span><span className="crew-name"><strong>Вільне місце</strong><small>надішліть код другу</small></span>
              </div>
            ))}
          </div>
        </section>
        <aside className="protocol-panel">
          <div className="panel-heading">
            <span><small>Правила кімнати</small><strong>{state.you.canManageBots ? "Налаштуйте гру" : "Обрані параметри"}</strong></span>
            {state.you.canManageBots && <em>Ви — творець</em>}
          </div>
          <div className="bot-controls">
            <div>
              <span><strong>Гравці-боти</strong><small>Самі відкривають карти й голосують</small></span>
              <b>{botCount}</b>
            </div>
            {state.you.canManageBots ? (
              <div className="bot-actions">
                <button disabled={busy || !hasFreeSeats} onClick={() => onAddBots(1)}>+ Додати бота</button>
                {missingForStart > 1 ? (
                  <button disabled={busy || !hasFreeSeats} onClick={() => onAddBots(missingForStart)}>Заповнити до старту</button>
                ) : null}
              </div>
            ) : (
              <p>Додавати й прибирати ботів може творець кімнати.</p>
            )}
          </div>
          {state.you.canManageBots ? (
            <div className="lobby-settings">
              <button
                className="manual-mode-button"
                onClick={() => setDraft((current) => ({ ...current, revealSeconds: 0, discussionSeconds: 0, votingSeconds: 0 }))}
              >
                <span>∞</span><strong>Усі фази без таймерів</strong><small>Гравці самі передають хід, а творець запускає наступну фазу</small>
              </button>
              <div className="lobby-setting-grid">
                <label className="compact-control">
                  <span>Учасників у грі</span>
                  <input type="number" min={4} max={12} step={1} inputMode="numeric" value={draft.maxPlayers} onChange={(event) => updateDraftPlayerCount(Number(event.target.value))} />
                  <small>Точна кількість: 4–12</small>
                </label>
                <label className="compact-control">
                  <span>Залишаться в бункері</span>
                  <input type="number" min={2} max={draft.maxPlayers - 1} step={1} inputMode="numeric" value={draft.seatsCount} onChange={(event) => updateDraft("seatsCount", Math.min(draft.maxPlayers - 1, Math.max(2, Number(event.target.value))))} />
                  <small>Точна кількість: 2–{draft.maxPlayers - 1}</small>
                </label>
              </div>
              <TimeSelect label="Хід і розповідь" description="Після відкриття гравець говорить і натискає «Передати хід»" value={draft.revealSeconds} options={timeOptions.reveal} onChange={(value) => updateDraft("revealSeconds", value)} />
              <TimeSelect label="Загальна дискусія" description="Творець кімнати запускає голосування вручну, якщо таймера немає" value={draft.discussionSeconds} options={timeOptions.discussion} onChange={(value) => updateDraft("discussionSeconds", value)} />
              <TimeSelect label="Голосування" description="Завершується після всіх голосів або вручну творцем" value={draft.votingSeconds} options={timeOptions.voting} onChange={(value) => updateDraft("votingSeconds", value)} />
              <Toggle checked={draft.publicVotes} onChange={(value) => updateDraft("publicVotes", value)} label="Відкрите голосування" description="Показувати кількість голосів у реальному часі" />
              <Toggle checked={draft.excludedCanVote} onChange={(value) => updateDraft("excludedCanVote", value)} label="Голос вигнаних" description="Гравці поза бункером зберігають право голосу" />
              <label className="select-row">
                <span><strong>Фінальна умова</strong><small>Як система оцінює склад групи</small></span>
                <select value={draft.victoryRule} onChange={(event) => updateDraft("victoryRule", event.target.value as RoomSettings["victoryRule"])}>
                  <option value="survival">Виживання</option><option value="legacy">Спадкоємність</option>
                </select>
              </label>
              <button className="save-rules-button" disabled={busy || !settingsChanged} onClick={() => onUpdateSettings(draft)}>
                {settingsChanged ? "Зберегти правила" : "Правила збережено"}
              </button>
              <small className="ready-reset-note">Після зміни правил живі гравці підтверджують готовність повторно.</small>
            </div>
          ) : (
            <dl className="settings-summary">
              <div><dt>Учасників у грі</dt><dd>{state.room.settings.maxPlayers}</dd></div>
              <div><dt>Місць у сховищі</dt><dd>{state.room.settings.seatsCount}</dd></div>
              <div><dt>Хід і розповідь</dt><dd>{durationLabel(state.room.settings.revealSeconds)}</dd></div>
              <div><dt>Дискусія</dt><dd>{durationLabel(state.room.settings.discussionSeconds)}</dd></div>
              <div><dt>Голосування</dt><dd>{durationLabel(state.room.settings.votingSeconds)}</dd></div>
              <div><dt>Голоси</dt><dd>{state.room.settings.publicVotes ? "відкриті" : "таємні"}</dd></div>
            </dl>
          )}
          <div className="rules-explainer">
            <strong>Як проходить гра</strong>
            <ol>
              <li><b>Відкрийте картку.</b> Уже в першому колі кожен сам обирає характеристику.</li>
              <li><b>Розкажіть про себе.</b> Без таймера можна говорити скільки потрібно.</li>
              <li><b>Передайте хід.</b> Наступний гравець відкриє свою характеристику.</li>
              <li><b>Обговоріть.</b> Перше коло минає без голосування, далі група виключає по одному кандидату.</li>
              <li><b>Активуйте особливі картки.</b> Вони змінюють досьє, обмінюють характеристики або впливають на голоси.</li>
            </ol>
            <p>Випадкових подій між раундами більше немає — у центрі гри люди, аргументи й активні картки.</p>
          </div>
        </aside>
      </div>
      <div className="ready-dock">
        <span>{state.you.ready ? "Ви готові. Очікуємо решту групи." : `Для старту зберіть ${state.room.settings.minPlayers} учасників і підтвердьте готовність усіх.`}</span>
        <button className={state.you.ready ? "secondary-button" : "primary-button"} disabled={busy} onClick={() => onReady(!state.you.ready)}>
          {state.you.ready ? "Скасувати готовність" : "Я готовий"}
        </button>
      </div>
    </main>
  );
}

function ScenarioCard({
  number,
  label,
  scenario,
  variant,
}: {
  number: string;
  label: string;
  scenario: Scenario | null;
  variant: "catastrophe" | "bunker" | "outside";
}) {
  if (!scenario) return null;
  return (
    <article className={`scenario-card scenario-${variant}`}>
      <div className="scenario-number">{number}</div>
      <div className="scenario-body">
        <small>{label}</small>
        <h3>{scenario.title}</h3>
        <p>{scenario.description}</p>
        <ul>{scenario.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
      </div>
    </article>
  );
}

function PlayerCard({
  player,
  state,
  onReveal,
  onVote,
  onUseAbility,
  busy,
}: {
  player: Player;
  state: GameState;
  onReveal: (category: string) => void;
  onVote: (id: string) => void;
  onUseAbility: (payload: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const canVote =
    ["voting", "runoff"].includes(state.room.phase) &&
    (state.you.active || state.room.settings.excludedCanVote) &&
    !state.you.voteTarget &&
    player.active &&
    !player.isYou &&
    (state.room.phase !== "runoff" || state.room.runoff.includes(player.id));
  const selected = state.you.voteTarget === player.id;
  const isTurn = state.room.phase === "reveal" && state.room.turnSeat === player.seat;
  const revealedThisRound = state.you.revealed.length >= state.room.round;
  const privateCards = player.isYou ? state.you.character : player.character ?? [];
  const publicVoteCount = state.room.voteCounts[player.id] ?? 0;
  const showVoteCount =
    state.room.settings.publicVotes &&
    ["voting", "runoff"].includes(state.room.phase) &&
    player.active &&
    (state.room.phase !== "runoff" || state.room.runoff.includes(player.id));
  return (
    <article className={`player-card ${!player.active ? "excluded" : ""} ${isTurn ? "current" : ""} ${selected ? "selected" : ""}`}>
      <div className="player-topline">
        <span className={`avatar small ${player.isBot ? "bot-avatar" : ""}`}>{player.isBot ? "AI" : player.name.slice(0, 1).toUpperCase()}</span>
        <div><strong>{player.name}{player.isYou ? " · ви" : ""}</strong><small>Місце {String(player.seat).padStart(2, "0")}{player.isBot ? " · бот" : ""}</small></div>
        <i className={player.online ? "online" : ""} />
      </div>
      <div className="player-effects">
        {player.protected && <span className="effect-shield">Щит −1 голос</span>}
        {player.doubleVote && <span className="effect-double">Голос ×2</span>}
        {player.hasVoted && ["voting", "runoff"].includes(state.room.phase) && <span className="effect-voted">Проголосував</span>}
      </div>
      <div className="player-profile-list">
        {profileCategories.map(([category, label]) => {
          const publicCard = player.revealed.find((card) => card.category === category);
          const privateCard = privateCards.find((card) => card.category === category);
          const card = privateCard ?? publicCard;
          const known = player.isYou || state.room.status === "finished" || Boolean(publicCard);
          const canReveal =
            player.isYou &&
            isTurn &&
            state.you.active &&
            !revealedThisRound &&
            !publicCard &&
            Boolean(privateCard);
          return (
            <div key={category} className={`profile-row ${known ? "known" : "hidden"} ${publicCard ? "public" : ""} ${canReveal ? "can-reveal" : ""}`}>
              <span className="profile-label"><CharacteristicIcon category={category} />{label}</span>
              {known && card?.note
                ? <InfoTooltip label={card.value} text={card.note} />
                : <span className="term-help-placeholder" aria-hidden="true" />}
              <span className="profile-value">
                <b>{known ? card?.value ?? "—" : "?"}</b>
              </span>
              {canReveal && (
                <button type="button" className="profile-reveal-button" disabled={busy} onClick={() => onReveal(category)}>Відкрити →</button>
              )}
            </div>
          );
        })}
        <PlayerAbilityCard
          player={player}
          state={state}
          busy={busy}
          onUseAbility={onUseAbility}
        />
      </div>
      {player.isYou && isTurn && (
        <div className="player-reveal-note">
          {revealedThisRound ? "Характеристику відкрито — передайте хід угорі." : "Ваш хід: оберіть характеристику зі списку."}
        </div>
      )}
      {showVoteCount && (
        <div className="player-vote-tally" aria-label={`${player.name}: отримано голосів — ${publicVoteCount}`}>
          <span>Отримано голосів</span>
          <strong>{publicVoteCount}</strong>
        </div>
      )}
      {!player.active && <div className="excluded-stamp">Поза бункером</div>}
      {isTurn && <div className="turn-badge">Зараз говорить</div>}
      {canVote && (
        <button className={`vote-button ${selected ? "selected" : ""}`} disabled={busy} onClick={() => onVote(player.id)}>
          {selected ? "✓ Ваш голос за цього гравця" : "Віддати голос"}
        </button>
      )}
    </article>
  );
}

function PlayerAbilityCard({
  player,
  state,
  busy,
  onUseAbility,
}: {
  player: Player;
  state: GameState;
  busy: boolean;
  onUseAbility: (payload: Record<string, unknown>) => void;
}) {
  const [abilityTarget, setAbilityTarget] = useState("");
  const [abilityCategory, setAbilityCategory] = useState("health");
  const privateAbility = player.isYou
    ? state.you.character.find((card) => card.category === "special")
    : undefined;
  const ability = privateAbility ?? player.ability;
  const abilityUsed = player.isYou ? state.you.abilityUsed : player.abilityUsed;
  const abilityKnown = player.isYou || abilityUsed;
  const needsTarget = ["swap", "expose", "scramble"].includes(ability?.action ?? "");
  const needsCategory = ["reroll_self", "swap", "expose", "scramble"].includes(ability?.action ?? "");
  const votingAbility = ["immunity", "double_vote"].includes(ability?.action ?? "");
  const abilityAvailable =
    Boolean(ability?.action) &&
    state.you.active &&
    !abilityUsed &&
    (!votingAbility || ["voting", "runoff"].includes(state.room.phase));
  const activeTargets = state.players.filter((player) => player.active && !player.isYou);
  return (
    <section className={`player-ability-card ${abilityKnown ? "known" : "hidden"} ${abilityUsed ? "used" : ""}`}>
      <div className="player-ability-summary">
        <span className="profile-label"><span className="ability-glyph" aria-hidden="true">✦</span>Активна карта</span>
        {abilityKnown && ability?.note
          ? <InfoTooltip label={ability.value} text={ability.note} />
          : <span className="term-help-placeholder" aria-hidden="true" />}
        <span className="profile-value">
          <b>{abilityKnown ? ability?.value ?? "—" : "?"}</b>
        </span>
        <em>{abilityUsed ? "Використано" : player.isYou ? "Готова" : "Прихована"}</em>
      </div>
      {player.isYou && !state.you.active && (
        <div className="spectator-note">Ви поза основним сховищем, але можете стежити за рішенням групи{state.room.settings.excludedCanVote ? " та голосувати" : ""}.</div>
      )}
      {player.isYou && !abilityUsed && ability && (
        <div className="player-ability-controls">
          {(needsTarget || needsCategory) && (
            <div className="ability-fields">
              {needsTarget && (
                <label>
                  <span>Гравець</span>
                  <select value={abilityTarget} onChange={(event) => setAbilityTarget(event.target.value)}>
                    <option value="">Оберіть гравця</option>
                    {activeTargets.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
                  </select>
                </label>
              )}
              {needsCategory && (
                <label>
                  <span>Характеристика</span>
                  <select value={abilityCategory} onChange={(event) => setAbilityCategory(event.target.value)}>
                    {profileCategories.map(([category, label]) => <option key={category} value={category}>{label}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          <button
            className="ability-button"
            disabled={busy || !abilityAvailable || (needsTarget && !abilityTarget)}
            onClick={() => onUseAbility({ targetId: abilityTarget, category: abilityCategory })}
          >
            {votingAbility && !["voting", "runoff"].includes(state.room.phase) ? "Доступно під час голосування" : "Активувати картку"}
          </button>
        </div>
      )}
    </section>
  );
}

function Finished({ state }: { state: GameState }) {
  const survivors = state.players.filter((player) => player.active);
  const outcome = state.room.outcome;
  return (
    <section className="finale">
      <div className="finale-seal"><span>{outcome?.score ?? 0}%</span><small>прогноз виживання</small></div>
      <div className="kicker"><span>05</span> Фінальний склад</div>
      <h2>{outcome?.title}</h2>
      <p>{outcome?.summary}</p>
      {outcome?.victoryRule === "legacy" && (
        <div className={`legacy-result ${outcome.legacyReady ? "good" : ""}`}>
          Умова спадкоємності: {outcome.legacyReady ? "склад має необхідне біологічне різноманіття" : "склад не виконує додаткову умову"}
        </div>
      )}
      <div className="survivor-grid">
        {survivors.map((player) => (
          <article key={player.id}>
            <span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span>
            <h3>{player.name}</h3>
            <p>{player.character?.find((card) => card.category === "profession")?.value}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RoundTimer({ phaseEndsAt }: { phaseEndsAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!phaseEndsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phaseEndsAt]);
  const remaining = phaseEndsAt ? phaseEndsAt - now : 0;
  return (
    <div className={`timer compact-timer ${phaseEndsAt && remaining < 10_000 ? "urgent" : ""} ${!phaseEndsAt ? "unlimited" : ""}`}>
      <span>{phaseEndsAt ? formatSeconds(remaining) : "∞"}</span>
      <small>{phaseEndsAt ? "до наступної дії" : "без обмеження"}</small>
    </div>
  );
}

function Game({
  state,
  busy,
  onReveal,
  onVote,
  onPassTurn,
  onAdvancePhase,
  onUseAbility,
  onHome,
  onLeave,
}: {
  state: GameState;
  busy: boolean;
  onReveal: (category: string) => void;
  onVote: (id: string) => void;
  onPassTurn: () => void;
  onAdvancePhase: () => void;
  onUseAbility: (payload: Record<string, unknown>) => void;
  onHome: () => void;
  onLeave: () => void;
}) {
  const phase =
    state.room.round === 1 && state.room.phase === "discussion"
      ? {
          eyebrow: "Перше коло",
          title: "Обговорення без голосування",
          hint: "Після дискусії гра одразу перейде до другого раунду — у першому колі ніхто не вибуває.",
        }
      : state.room.phase === "voting" && state.room.settings.publicVotes
        ? {
            ...phaseCopy.voting,
            title: "Відкрите голосування",
            hint: "Оберіть кандидата. Кількість отриманих голосів оновлюється на картках у реальному часі.",
          }
      : phaseCopy[state.room.phase] ?? phaseCopy.briefing;
  const turnPlayer = state.players.find((player) => player.seat === state.room.turnSeat);
  const yourTurn = state.room.phase === "reveal" && turnPlayer?.isYou && state.you.active;
  const revealedThisRound = state.you.revealed.length >= state.room.round;
  const canSkipTurn = state.room.phase === "reveal" && state.you.canControlPhases && turnPlayer && !turnPlayer.isYou && !turnPlayer.isBot;
  const manualPhaseLabel =
    state.you.canControlPhases
      ? state.room.phase === "briefing"
        ? "Почати відкриття карток"
        : state.room.phase === "discussion"
          ? state.room.round === 1
            ? "Перейти до другого раунду"
            : "Почати голосування"
          : ["voting", "runoff"].includes(state.room.phase)
            ? "Завершити голосування"
            : ""
      : "";
  const eligibleVoters = state.room.settings.excludedCanVote
    ? state.players
    : state.players.filter((player) => player.active);
  const votesCast = eligibleVoters.filter((player) => player.hasVoted).length;
  return (
    <main className={`game-shell phase-${state.room.phase}`}>
      <header className="game-header">
        <Logo onHome={onHome} />
        <div className="room-pill"><small>Кімната</small><strong>{state.room.code}</strong></div>
        <div className="game-meta">
          <span><small>Раунд</small><strong>{String(state.room.round).padStart(2, "0")}</strong></span>
          <span><small>У бункері</small><strong>{state.players.filter((player) => player.active).length}/{state.room.seats}</strong></span>
          <button className="quiet-button" onClick={onLeave}>Вийти</button>
        </div>
      </header>

      <section className="phase-bar">
        <div className="phase-copy"><small>{phase.eyebrow}</small><h1>{phase.title}</h1><p>{phase.hint}</p></div>
      </section>

      <div className="game-layout">
        <section className="table-panel">
          {state.room.status === "finished" ? <Finished state={state} /> : (
            <>
              <section className="scenario-strip" aria-label="Умови виживання">
                <div className="scenario-strip-heading"><small>Умови виживання</small><strong>Катастрофа · бункер · поверхня</strong></div>
                <div className="scenario-stack">
                  <ScenarioCard number="01" label="Катастрофа" scenario={state.room.catastrophe} variant="catastrophe" />
                  <ScenarioCard number="02" label="Бункер" scenario={state.room.bunker} variant="bunker" />
                  <ScenarioCard number="03" label="Стан поверхні" scenario={state.room.outside} variant="outside" />
                </div>
              </section>
              <section className="round-control-dock" aria-label="Керування раундом">
                <div className="round-control-status">
                  <span className="control-round">Раунд {String(state.room.round).padStart(2, "0")}</span>
                  <strong>{turnPlayer ? `${turnPlayer.isYou ? "Ваш хід" : `Хід: ${turnPlayer.name}`}` : phase.title}</strong>
                  <small>{yourTurn && !revealedThisRound ? "Оберіть характеристику у своїй картці" : phase.hint}</small>
                </div>
                <div className="round-control-actions">
                  {(yourTurn && revealedThisRound) && <button className="pass-turn-button" disabled={busy} onClick={onPassTurn}>Передати хід →</button>}
                  {canSkipTurn && <button className="host-phase-button" disabled={busy} onClick={onPassTurn}>Пропустити хід: {turnPlayer.name}</button>}
                  {manualPhaseLabel && <button className="host-phase-button primary" disabled={busy} onClick={onAdvancePhase}>{manualPhaseLabel}</button>}
                  <RoundTimer phaseEndsAt={state.room.phaseEndsAt} />
                </div>
              </section>
              <div className={`table-heading ${["voting", "runoff"].includes(state.room.phase) ? "voting-heading" : ""}`}>
                <span><small>Кандидати</small><strong>{state.players.filter((player) => player.active).length} активних</strong></span>
                {["voting", "runoff"].includes(state.room.phase) && (
                  <em>
                    {state.you.voteTarget ? "✓ Ваш голос зафіксовано" : "Оберіть кандидата нижче"}
                    {" · "}Проголосували {votesCast}/{eligibleVoters.length}
                  </em>
                )}
              </div>
              <div className="player-grid">
                {state.players.map((player) => (
                  <PlayerCard
                    key={player.id}
                    player={player}
                    state={state}
                    onReveal={onReveal}
                    onVote={onVote}
                    onUseAbility={onUseAbility}
                    busy={busy}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default function GameClient() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [showHome, setShowHome] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initialCode = useMemo(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "", []);

  const saveSession = (next: Session | null) => {
    setSession(next);
    if (next) localStorage.setItem(sessionKey, JSON.stringify(next));
    else localStorage.removeItem(sessionKey);
  };

  const loadState = useCallback(async (current: Session, quiet = false) => {
    try {
      const query = new URLSearchParams(current);
      const response = await fetch(`/api/game?${query}`, { cache: "no-store" });
      const data = await response.json() as { state?: GameState; error?: string };
      if (!response.ok) throw new Error(data.error || "Не вдалося оновити стан.");
      if (data.state) {
        const nextState = data.state;
        setState((current) => current && gameStateFingerprint(current) === gameStateFingerprint(nextState) ? current : nextState);
      }
      setError("");
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "Немає зв’язку із сервером.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    try {
      const stored = localStorage.getItem(sessionKey);
      if (stored) {
        const restored = JSON.parse(stored) as Session;
        queueMicrotask(() => {
          if (!cancelled) setSession(restored);
        });
      }
    } catch {
      localStorage.removeItem(sessionKey);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let requestInFlight = false;
    const refresh = async (quiet: boolean) => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        await loadState(session, quiet);
      } finally {
        requestInFlight = false;
      }
    };
    const kickoff = window.setTimeout(() => void refresh(false), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 1600);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [session, loadState]);

  const post = async (payload: Record<string, unknown>, includeSession = false) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(includeSession && session ? { ...payload, ...session } : payload),
      });
      const data = await response.json() as { session?: Session; state?: GameState; error?: string };
      if (!response.ok) throw new Error(data.error || "Дія не виконана.");
      if (data.session) {
        saveSession(data.session);
        setShowHome(false);
        await loadState(data.session);
      }
      if (data.state) setState(data.state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Невідома помилка.");
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    saveSession(null);
    setState(null);
    setError("");
    setShowHome(true);
    window.history.replaceState({}, "", window.location.pathname);
  };

  if (!session || showHome) {
    return (
      <Landing
        busy={busy}
        error={error}
        initialCode={initialCode}
        activeGame={session ? { code: session.code, status: state?.room.status, round: state?.room.round } : undefined}
        onCreate={(payload) => void post({ action: "create", ...payload })}
        onJoin={(payload) => void post({ action: "join", ...payload })}
        onResume={() => setShowHome(false)}
      />
    );
  }
  if (!state) {
    return <main className="loading-screen"><Logo onHome={() => setShowHome(true)} /><div className="loader"><i /><span>Відновлюємо захищений канал…</span></div>{error && <><p>{error}</p><button className="secondary-button" onClick={leave}>Повернутися на старт</button></>}</main>;
  }
  if (state.room.status === "lobby") {
    return (
      <>
        <Lobby
          state={state}
          busy={busy}
          onReady={(ready) => void post({ action: "ready", ready }, true)}
          onAddBots={(count) => void post({ action: "addBots", count }, true)}
          onRemoveBot={(botId) => void post({ action: "removeBot", botId }, true)}
          onUpdateSettings={(settings) => void post({ action: "updateSettings", settings }, true)}
          onHome={() => setShowHome(true)}
          onLeave={leave}
        />
        {error && <div className="global-error-toast" role="alert">{error}</div>}
      </>
    );
  }
  return (
    <>
      <Game
        state={state}
        busy={busy}
        onReveal={(category) => void post({ action: "reveal", category }, true)}
        onVote={(targetId) => void post({ action: "vote", targetId }, true)}
        onPassTurn={() => void post({ action: "passTurn" }, true)}
        onAdvancePhase={() => void post({ action: "advancePhase" }, true)}
        onUseAbility={(payload) => void post({ action: "useAbility", ...payload }, true)}
        onHome={() => setShowHome(true)}
        onLeave={leave}
      />
      {error && <div className="global-error-toast" role="alert">{error}</div>}
    </>
  );
}
