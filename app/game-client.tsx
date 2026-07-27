"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  seatsPercent: number;
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

function durationLabel(seconds: number) {
  if (seconds === 0) return "Без обмеження";
  if (seconds < 60) return `${seconds} с`;
  return seconds % 60 === 0 ? `${seconds / 60} хв` : `${Math.floor(seconds / 60)} хв ${seconds % 60} с`;
}

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function Logo() {
  return (
    <div className="brand" aria-label="Бункер: Протокол">
      <span className="brand-mark"><i /></span>
      <span>
        <strong>Бункер</strong>
        <small>Протокол виживання</small>
      </span>
    </div>
  );
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
  onCreate,
  onJoin,
}: {
  busy: boolean;
  error: string;
  initialCode: string;
  onCreate: (payload: Record<string, unknown>) => void;
  onJoin: (payload: Record<string, unknown>) => void;
}) {
  const [tab, setTab] = useState<"create" | "join">(initialCode ? "join" : "create");
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [advanced, setAdvanced] = useState(false);
  const [settings, setSettings] = useState({
    minPlayers: 4,
    maxPlayers: 8,
    seatsPercent: 50,
    revealSeconds: 0,
    discussionSeconds: 0,
    votingSeconds: 0,
    publicVotes: false,
    excludedCanVote: false,
    victoryRule: "survival",
  });

  const update = (key: string, value: string | number | boolean) =>
    setSettings((current) => ({ ...current, [key]: value }));

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
                <span>Гравців</span>
                <select value={settings.maxPlayers} onChange={(event) => update("maxPlayers", Number(event.target.value))}>
                  {[6, 8, 10, 12].map((value) => <option key={value} value={value}>до {value}</option>)}
                </select>
              </label>
              <label>
                <span>Місць у бункері</span>
                <select value={settings.seatsPercent} onChange={(event) => update("seatsPercent", Number(event.target.value))}>
                  <option value={40}>40%</option>
                  <option value={50}>50%</option>
                  <option value={60}>60%</option>
                </select>
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
                <Toggle checked={settings.publicVotes} onChange={(value) => update("publicVotes", value)} label="Відкрите голосування" description="Показувати вибір одразу" />
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
          onClick={() => tab === "create" ? onCreate({ name, settings: { ...settings, minPlayers: 4 } }) : onJoin({ name, code })}
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
  onLeave,
}: {
  state: GameState;
  busy: boolean;
  onReady: (ready: boolean) => void;
  onAddBots: (count: number) => void;
  onRemoveBot: (botId: string) => void;
  onUpdateSettings: (settings: RoomSettings) => void;
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
        <Logo />
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
                  <span>Максимум гравців</span>
                  <select value={draft.maxPlayers} onChange={(event) => updateDraft("maxPlayers", Number(event.target.value))}>
                    {Array.from({ length: 9 }, (_, index) => index + 4).map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="compact-control">
                  <span>Місць у бункері</span>
                  <select value={draft.seatsPercent} onChange={(event) => updateDraft("seatsPercent", Number(event.target.value))}>
                    <option value={40}>40%</option><option value={50}>50%</option><option value={60}>60%</option>
                  </select>
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
              <div><dt>Гравців</dt><dd>до {state.room.settings.maxPlayers}</dd></div>
              <div><dt>Місць у сховищі</dt><dd>{state.room.settings.seatsPercent}%</dd></div>
              <div><dt>Хід і розповідь</dt><dd>{durationLabel(state.room.settings.revealSeconds)}</dd></div>
              <div><dt>Дискусія</dt><dd>{durationLabel(state.room.settings.discussionSeconds)}</dd></div>
              <div><dt>Голосування</dt><dd>{durationLabel(state.room.settings.votingSeconds)}</dd></div>
              <div><dt>Голоси</dt><dd>{state.room.settings.publicVotes ? "відкриті" : "таємні"}</dd></div>
            </dl>
          )}
          <div className="rules-explainer">
            <strong>Як проходить гра</strong>
            <ol>
              <li><b>Відкрийте картку.</b> У першому колі всі починають із професії.</li>
              <li><b>Розкажіть про себе.</b> Без таймера можна говорити скільки потрібно.</li>
              <li><b>Передайте хід.</b> Наступний гравець відкриє свою характеристику.</li>
              <li><b>Обговоріть і голосуйте.</b> Після кола група виключає одного кандидата.</li>
              <li><b>Активуйте особливі картки.</b> Вони змінюють досьє, обмінюють характеристики або впливають на голоси.</li>
            </ol>
            <p>Випадкових подій між раундами більше немає — у центрі гри люди, аргументи й активні картки.</p>
          </div>
        </aside>
      </div>
      <div className="ready-dock">
        <span>{state.you.ready ? "Ви готові. Очікуємо решту групи." : `Для старту потрібно щонайменше ${state.room.settings.minPlayers} гравці та готовність усіх.`}</span>
        <button className={state.you.ready ? "secondary-button" : "primary-button"} disabled={busy} onClick={() => onReady(!state.you.ready)}>
          {state.you.ready ? "Скасувати готовність" : "Я готовий"}
        </button>
      </div>
    </main>
  );
}

function ScenarioCard({ number, label, scenario }: { number: string; label: string; scenario: Scenario | null }) {
  if (!scenario) return null;
  return (
    <article className="scenario-card">
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
  onVote,
  busy,
}: {
  player: Player;
  state: GameState;
  onVote: (id: string) => void;
  busy: boolean;
}) {
  const canVote =
    ["voting", "runoff"].includes(state.room.phase) &&
    (state.you.active || state.room.settings.excludedCanVote) &&
    player.active &&
    !player.isYou &&
    (state.room.phase !== "runoff" || state.room.runoff.includes(player.id));
  const selected = state.you.voteTarget === player.id;
  const isTurn = state.room.phase === "reveal" && state.room.turnSeat === player.seat;
  const publicVoteCount = Object.values(state.room.votes).filter((targetId) => targetId === player.id).length;
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
      <div className="revealed-list">
        {player.revealed.length ? player.revealed.map((card) => (
          <div key={card.category}><span>{card.label}</span><b>{card.value}</b></div>
        )) : <p>Досьє ще закрите</p>}
      </div>
      {!player.active && <div className="excluded-stamp">Поза бункером</div>}
      {isTurn && <div className="turn-badge">Зараз говорить</div>}
      {canVote && (
        <button className={`vote-button ${selected ? "selected" : ""}`} disabled={busy} onClick={() => onVote(player.id)}>
          {selected ? "✓ Ваш голос за цього гравця" : "Віддати голос"}
        </button>
      )}
      {state.room.settings.publicVotes && publicVoteCount > 0 && <span className="public-vote">{publicVoteCount} {publicVoteCount === 1 ? "голос" : "голоси"}</span>}
    </article>
  );
}

function Dossier({
  state,
  busy,
  onReveal,
  onUseAbility,
}: {
  state: GameState;
  busy: boolean;
  onReveal: (category: string) => void;
  onUseAbility: (payload: Record<string, unknown>) => void;
}) {
  const [abilityTarget, setAbilityTarget] = useState("");
  const [abilityCategory, setAbilityCategory] = useState("health");
  const yourTurn = state.room.phase === "reveal" && state.room.turnSeat === state.you.seat && state.you.active;
  const revealedThisRound = state.you.revealed.length >= state.room.round;
  const ability = state.you.character.find((card) => card.category === "special");
  const needsTarget = ["swap", "expose", "scramble"].includes(ability?.action ?? "");
  const needsCategory = ["reroll_self", "swap", "expose", "scramble"].includes(ability?.action ?? "");
  const votingAbility = ["immunity", "double_vote"].includes(ability?.action ?? "");
  const abilityAvailable =
    Boolean(ability?.action) &&
    state.you.active &&
    !state.you.abilityUsed &&
    (!votingAbility || ["voting", "runoff"].includes(state.room.phase));
  const activeTargets = state.players.filter((player) => player.active && !player.isYou);
  return (
    <aside className="dossier-panel">
      <div className="dossier-header">
        <span><small>Приватно</small><strong>Ваше досьє</strong></span>
        <em>{state.you.revealed.length} / {state.you.character.length}</em>
      </div>
      {!state.you.active && <div className="spectator-note">Ви поза основним сховищем, але можете стежити за рішенням групи{state.room.settings.excludedCanVote ? " та голосувати" : ""}.</div>}
      {ability && (
        <section className={`ability-panel ${state.you.abilityUsed ? "used" : ""}`}>
          <div className="ability-heading">
            <span><small>Активна картка · один раз за гру</small><strong>{ability.value}</strong></span>
            <em>{state.you.abilityUsed ? "Використано" : "Готова"}</em>
          </div>
          <p>{ability.note}</p>
          {!state.you.abilityUsed && (
            <>
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
                        {Object.entries(categoryNames).map(([category, label]) => <option key={category} value={category}>{label}</option>)}
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
            </>
          )}
        </section>
      )}
      <div className="dossier-cards">
        {state.you.character.map((card, index) => {
          const revealed = state.you.revealed.includes(card.category);
          const lockedProfession = state.room.round === 1 && card.category !== "profession";
          return (
            <button
              key={card.category}
              className={`dossier-card ${revealed ? "revealed" : ""} ${card.tone} ${card.category === "special" ? "active-special" : ""}`}
              disabled={!yourTurn || revealed || lockedProfession || busy || revealedThisRound}
              onClick={() => onReveal(card.category)}
            >
              <span className="card-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="card-copy"><small>{card.label}</small><strong>{card.value}</strong><em>{card.note}</em></span>
              <i>{revealed ? "Відкрито групі" : yourTurn && !lockedProfession && !revealedThisRound ? "Відкрити групі →" : "Приватно"}</i>
            </button>
          );
        })}
      </div>
      {yourTurn && (
        <div className="your-turn-note">
          <span className="pulse-dot" />
          {revealedThisRound ? "Картку відкрито. Розкажіть про неї та натисніть «Передати хід» угорі." : "Ваш хід. Оберіть одну характеристику для відкриття."}
        </div>
      )}
    </aside>
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

function Game({
  state,
  busy,
  onReveal,
  onVote,
  onPassTurn,
  onAdvancePhase,
  onUseAbility,
  onLeave,
}: {
  state: GameState;
  busy: boolean;
  onReveal: (category: string) => void;
  onVote: (id: string) => void;
  onPassTurn: () => void;
  onAdvancePhase: () => void;
  onUseAbility: (payload: Record<string, unknown>) => void;
  onLeave: () => void;
}) {
  const [now, setNow] = useState(0);
  const [scenarioTab, setScenarioTab] = useState<"scenario" | "log">("scenario");
  useEffect(() => {
    const update = () => setNow(Date.now());
    const kickoff = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 250);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, []);
  const phase = phaseCopy[state.room.phase] ?? phaseCopy.briefing;
  const remaining = state.room.phaseEndsAt ? state.room.phaseEndsAt - now : 0;
  const turnPlayer = state.players.find((player) => player.seat === state.room.turnSeat);
  const yourTurn = state.room.phase === "reveal" && turnPlayer?.isYou && state.you.active;
  const revealedThisRound = state.you.revealed.length >= state.room.round;
  const canSkipTurn = state.room.phase === "reveal" && state.you.canControlPhases && turnPlayer && !turnPlayer.isYou && !turnPlayer.isBot;
  const manualPhaseLabel =
    state.you.canControlPhases
      ? state.room.phase === "briefing"
        ? "Почати відкриття карток"
        : state.room.phase === "discussion"
          ? "Почати голосування"
          : ["voting", "runoff"].includes(state.room.phase)
            ? "Завершити голосування"
            : ""
      : "";
  return (
    <main className={`game-shell phase-${state.room.phase}`}>
      <header className="game-header">
        <Logo />
        <div className="room-pill"><small>Кімната</small><strong>{state.room.code}</strong></div>
        <div className="game-meta">
          <span><small>Раунд</small><strong>{String(state.room.round).padStart(2, "0")}</strong></span>
          <span><small>У бункері</small><strong>{state.players.filter((player) => player.active).length}/{state.room.seats}</strong></span>
          <button className="quiet-button" onClick={onLeave}>Вийти</button>
        </div>
      </header>

      <section className="phase-bar">
        <div className="phase-copy"><small>{phase.eyebrow}</small><h1>{phase.title}</h1><p>{phase.hint}</p></div>
        <div className="phase-controls">
          {(yourTurn && revealedThisRound) && <button className="pass-turn-button" disabled={busy} onClick={onPassTurn}>Передати хід →</button>}
          {canSkipTurn && <button className="host-phase-button" disabled={busy} onClick={onPassTurn}>Пропустити хід: {turnPlayer.name}</button>}
          {manualPhaseLabel && <button className="host-phase-button primary" disabled={busy} onClick={onAdvancePhase}>{manualPhaseLabel}</button>}
          <div className={`timer ${state.room.phaseEndsAt && remaining < 10_000 ? "urgent" : ""} ${!state.room.phaseEndsAt ? "unlimited" : ""}`}>
            <span>{state.room.phaseEndsAt ? formatSeconds(remaining) : "∞"}</span>
            <small>{state.room.phaseEndsAt ? (turnPlayer ? `Хід: ${turnPlayer.name}` : "до наступної фази") : (turnPlayer ? `Говорить: ${turnPlayer.name}` : "без обмеження часу")}</small>
          </div>
        </div>
      </section>

      <div className="game-layout">
        <aside className="scenario-panel">
          <div className="mini-tabs">
            <button className={scenarioTab === "scenario" ? "active" : ""} onClick={() => setScenarioTab("scenario")}>Умови</button>
            <button className={scenarioTab === "log" ? "active" : ""} onClick={() => setScenarioTab("log")}>Журнал</button>
          </div>
          {scenarioTab === "scenario" ? (
            <div className="scenario-stack">
              <ScenarioCard number="01" label="Катастрофа" scenario={state.room.catastrophe} />
              <ScenarioCard number="02" label="Сховище" scenario={state.room.bunker} />
              <ScenarioCard number="03" label="Поверхня" scenario={state.room.outside} />
            </div>
          ) : (
            <div className="event-log">
              {[...state.room.log].reverse().map((entry, index) => (
                <div key={`${entry.at}-${index}`}><span>{new Date(entry.at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span><p>{entry.text}</p></div>
              ))}
            </div>
          )}
        </aside>

        <section className="table-panel">
          {state.room.status === "finished" ? <Finished state={state} /> : (
            <>
              <div className={`table-heading ${["voting", "runoff"].includes(state.room.phase) ? "voting-heading" : ""}`}>
                <span><small>Кандидати</small><strong>{state.players.filter((player) => player.active).length} активних</strong></span>
                {["voting", "runoff"].includes(state.room.phase) && (
                  <em>{state.you.voteTarget ? "✓ Ваш голос зафіксовано" : "Оберіть кандидата нижче"}</em>
                )}
              </div>
              <div className="player-grid">
                {state.players.map((player) => <PlayerCard key={player.id} player={player} state={state} onVote={onVote} busy={busy} />)}
              </div>
            </>
          )}
        </section>

        <Dossier state={state} busy={busy} onReveal={onReveal} onUseAbility={onUseAbility} />
      </div>
    </main>
  );
}

export default function GameClient() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<GameState | null>(null);
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
      if (data.state) setState(data.state);
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
    const kickoff = window.setTimeout(() => void loadState(session), 0);
    const timer = window.setInterval(() => void loadState(session, true), 1400);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
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
    window.history.replaceState({}, "", window.location.pathname);
  };

  if (!session) {
    return <Landing busy={busy} error={error} initialCode={initialCode} onCreate={(payload) => void post({ action: "create", ...payload })} onJoin={(payload) => void post({ action: "join", ...payload })} />;
  }
  if (!state) {
    return <main className="loading-screen"><Logo /><div className="loader"><i /><span>Відновлюємо захищений канал…</span></div>{error && <><p>{error}</p><button className="secondary-button" onClick={leave}>Повернутися на старт</button></>}</main>;
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
        onLeave={leave}
      />
      {error && <div className="global-error-toast" role="alert">{error}</div>}
    </>
  );
}
