import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ChevronDown,
  Pause,
  Smile,
  Inbox,
  Library,
  ChartNoAxesCombined,
  Settings,
  Users,
  Smartphone,
  LogOut,
  Search,
  Send,
  Sparkles,
  PanelRightClose,
  Plus,
  Paperclip,
  FileText,
  Download,
  RefreshCw,
  Trash2,
  ShieldCheck,
  ChevronRight,
  MessageCircle,
  Check,
  Menu,
} from "lucide-react";
import { api, time, labels } from "./api";
import {
  countryOptions,
  countryName,
  localClock,
} from "../../../packages/domain/location";
import "./style.css";
import { PdfPreview } from "./PdfPreview";
function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="empty">
      <MessageCircle size={32} />
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
    </div>
  );
}
function Field({ label, children }: any) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Badge({ value }: any) {
  return <span className={"badge " + value}>{labels[value] || value}</span>;
}
function App() {
  const [user, setUser] = useState<any>(null),
    [boot, setBoot] = useState(true),
    [page, setPage] = useState("inbox"),
    [tick, setTick] = useState(0),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false);
  const notify = (e: any) => setToast(typeof e === "string" ? e : e.message);
  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      const result = await fn();
      setTick((x) => x + 1);
      return result;
    } catch (e) {
      notify(e);
    } finally {
      setBusy(false);
    }
  };
  const refreshUser = () =>
    api("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setBoot(false));
  useEffect(() => {
    void refreshUser();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user) return;
    let closed = false,
      ws: WebSocket,
      timer: any;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/events`,
      );
      ws.onmessage = () => setTick((x) => x + 1);
      ws.onclose = () => {
        if (!closed)
          timer = setTimeout(() => {
            void refreshUser();
            connect();
          }, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [user?.id]);
  useEffect(() => {
    setPage("inbox");
    setToast("");
  }, [user?.id]);
  if (boot) return <div className="loading">SmarChat</div>;
  if (!user)
    return (
      <>
        <Login onLogin={refreshUser} notify={notify} />
        {toast && (
          <div className="toast" role="alert">
            {toast}
          </div>
        )}
      </>
    );
  const setup = user.mustChange;
  if (setup)
    return (
      <>
        <Onboarding user={user} done={refreshUser} act={act} busy={busy} />
        {toast && (
          <div className="toast" role="alert">
            {toast}
          </div>
        )}
      </>
    );
  const isAdmin = user.role === "superadmin",
    nav = [
      ["inbox", "收件箱", Inbox],
      ["trash", "回收站", Trash2],
      ["library", "资料库", Library],
      ["analytics", "数据分析", ChartNoAxesCombined],
      ...(isAdmin
        ? [
            ["accounts", "WhatsApp", Smartphone],
            ["users", "团队账号", Users],
          ]
        : []),
      ["settings", isAdmin ? "AI 与规则" : "对话规则", Settings],
    ] as any[];
  return (
    <div className="shell" aria-busy={busy}>
      <aside className="rail">
        <div className="brand">
          <img src="/SmarChat.png" alt="Rosa" />
          <b>SmarChat</b>
        </div>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => setPage(key)}
              title={label}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <button onClick={() => setPage("profile")} title="我的账号">
            <span className="avatar small">{user.name[0]}</span>
            <span>{user.name}</span>
          </button>
          <button
            title="退出登录"
            onClick={() =>
              act(async () => {
                await api("/auth/logout", "POST", {});
                setUser(null);
              })
            }
          >
            <LogOut size={19} />
            <span>退出</span>
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <b>
              {
                (
                  {
                    inbox: "Inbox",
                    trash: "Trash",
                    library: "Library",
                    analytics: "Analytics",
                    accounts: "WhatsApp",
                    users: "Team",
                    settings: "AI & Rules",
                    profile: "Account",
                  } as any
                )[page]
              }
            </b>
            <span>TEAM WORKSPACE</span>
          </div>
          <div className="top-meta">
            <span className="dot" /> {user.name}
            <Badge value={user.role} />
          </div>
        </header>
        {["inbox", "trash"].includes(page) && (
          <InboxPage
            key={page}
            trash={page === "trash"}
            user={user}
            tick={tick}
            act={act}
            notify={notify}
          />
        )}
        {page === "library" && (
          <LibraryPage user={user} tick={tick} act={act} notify={notify} />
        )}
        {page === "analytics" && (
          <AnalyticsPage user={user} tick={tick} notify={notify} />
        )}
        {page === "accounts" && isAdmin && (
          <AccountsPage tick={tick} act={act} notify={notify} />
        )}
        {page === "users" && isAdmin && (
          <UsersPage user={user} tick={tick} act={act} notify={notify} />
        )}
        {page === "settings" && (
          <SettingsPage user={user} tick={tick} act={act} notify={notify} />
        )}
        {page === "profile" && (
          <ProfilePage user={user} act={act} notify={notify} />
        )}
      </main>
      {toast && (
        <div className="toast" role="alert" onClick={() => setToast("")}>
          {toast}
        </div>
      )}
    </div>
  );
}
function Login({ onLogin, notify }: any) {
  const [username, setUsername] = useState("Bison01"),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [reset, setReset] = useState(false),
    [resetToken, setResetToken] = useState("");
  return (
    <div className="auth-screen">
      <div className="auth-story">
        <img src="/SmarChat.png" alt="Rosa" />
        <div>
          <span>SMARCHAT / TEAM</span>
          <h1>
            每一段对话，
            <br />
            都有下一步。
          </h1>
          <p>连接客户，沉淀需求，让团队接续每一次沟通。</p>
        </div>
        <small>Private workspace · Your team, connected.</small>
      </div>
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (reset) {
              await api("/auth/reset", "POST", {
                token: resetToken,
                password,
              });
              setReset(false);
              notify("密码已重置，请登录");
            } else {
              await api("/auth/login", "POST", { username, password });
              onLogin();
            }
          } catch (e) {
            notify(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="eyebrow">WELCOME TO SMARCHAT</div>
        <h2>{reset ? "重置密码" : "登录工作区"}</h2>
        <p className="muted">使用管理员分配的团队账号。</p>
        {reset ? (
          <Field label="一次性重置令牌">
            <input
              required
              value={resetToken}
              onChange={(e) => setResetToken(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="用户名">
            <input
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
        )}
        <Field label={reset ? "新密码（至少 6 位）" : "密码"}>
          <input
            type="password"
            autoComplete={reset ? "new-password" : "current-password"}
            minLength={reset ? 6 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className="primary wide" disabled={busy}>
          {busy ? "请稍候…" : reset ? "更新密码" : "登录"}
          <ChevronRight size={17} />
        </button>
        <button className="link" type="button" onClick={() => setReset(!reset)}>
          {reset ? "返回登录" : "使用管理员提供的重置令牌"}
        </button>
      </form>
    </div>
  );
}
function Onboarding({ done, act, busy }: any) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState("");
  return (
    <div className="setup">
      <div className="setup-card">
        <ShieldCheck size={30} />
        <h2>设置您的登录密码</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await api("/auth/password", "POST", { current, password });
              await done();
            });
          }}
        >
          <Field label="初始密码">
            <input
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="新密码（至少 6 位）">
            <input
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button className="primary" disabled={busy}>
            保存新密码
          </button>
        </form>
      </div>
    </div>
  );
}
function InboxPage({ user, tick, act, notify, trash = false }: any) {
  const editor = useRef<HTMLTextAreaElement>(null),
    sendingLock = useRef(false),
    composing = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false),
    [emojiOpen, setEmojiOpen] = useState(false);

  const [list, setList] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [chat, setChat] = useState<any>(null),
    [messages, setMessages] = useState<any[]>([]),
    [q, setQ] = useState(""),
    [customerCursor, setCustomerCursor] = useState(""),
    [account, setAccount] = useState(""),
    [accounts, setAccounts] = useState<any[]>([]),
    [draft, setDraft] = useState(""),
    [draftRevision, setDraftRevision] = useState(0),
    [jobs, setJobs] = useState<any[]>([]),
    [outbox, setOutbox] = useState<any[]>([]),
    [users, setUsers] = useState<any[]>([]),
    [attachment, setAttachment] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [older, setOlder] = useState(false),
    [viewers, setViewers] = useState<any[]>([]);
  const applied = useRef(new Set<string>()),
    pendingReplies = useRef(new Map<string, string>()),
    sendAttempt = useRef<any>(null),
    request = useRef(0),
    messageEnd = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null),
    [insight, setInsight] = useState(true);
  useEffect(() => {
    setCustomerCursor("");
  }, [q, account, trash]);
  useEffect(() => {
    let current = true;
    const t = setTimeout(
      () =>
        api(
          `/conversations?q=${encodeURIComponent(q)}&account=${account}&trash=${trash}${customerCursor}`,
        )
          .then((rows) => {
            if (current) setList(rows);
          })
          .catch((e) => {
            if (current) notify(e);
          }),
      200,
    );
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [q, account, trash, customerCursor, tick]);
  useEffect(() => {
    api("/accounts").then(setAccounts).catch(notify);
    if (user.role !== "member") api("/users").then(setUsers).catch(notify);
  }, [tick]);
  useEffect(() => {
    const n = ++request.current;
    setChat(null);
    setMessages([]);
    setOlder(false);
    setAttachment(null);
    if (!selected) return;
    Promise.all([
      api(`/conversations/${selected}`),
      api(`/conversations/${selected}/messages`),
      api(`/conversations/${selected}/draft`),
    ])
      .then(([c, m, d]) => {
        if (n !== request.current) return;
        setChat(c);
        setMessages(m);
        setDraft(d.text);
        setDraftRevision(d.revision);
        setTimeout(
          () => messageEnd.current?.scrollIntoView({ block: "end" }),
          100,
        );
      })
      .catch(notify);
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    let current = true;
    Promise.all([
      api(`/conversations/${selected}`),
      api(`/conversations/${selected}/messages`),
      api(`/conversations/${selected}/outbox`),
      api("/jobs"),
      api(`/conversations/${selected}/view`, "POST", {}),
    ])
      .then(([c, m, o, j, views]) => {
        if (!current) return;
        setChat(c);
        if (!older) setMessages(m);
        else
          setMessages((previous) =>
            [
              ...new Map([...previous, ...m].map((x) => [x.id, x])).values(),
            ].sort(
              (a, b) =>
                new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime() ||
                a.id.localeCompare(b.id),
            ),
          );
        setOutbox(o);
        setJobs(j);
        setViewers(views);
        for (const job of j) {
          if (
            job.conversation_id === selected &&
            job.user_id === user.id &&
            job.kind === "reply" &&
            job.status === "done" &&
            !applied.current.has(job.id) &&
            pendingReplies.current.has(job.id)
          ) {
            applied.current.add(job.id);
            const original = pendingReplies.current.get(job.id);
            setDraft((current) =>
              current === original ? job.result.draft : current,
            );
            pendingReplies.current.delete(job.id);
          }
        }
      })
      .catch(() => {
        setChat(null);
        setSelected("");
        setMessages([]);
      });
    return () => {
      current = false;
    };
  }, [tick, selected, older]);
  const update = (body: any) =>
    act(async () => {
      await api(`/conversations/${selected}`, "PATCH", {
        revision: chat.revision,
        ...body,
      });
      setChat(await api(`/conversations/${selected}`));
    });
  const job = (kind: string, messageId?: string) =>
    act(async () => {
      const j = await api(`/conversations/${selected}/jobs`, "POST", {
        kind,
        messageId,
      });
      if (kind === "reply") pendingReplies.current.set(j.id, draft);
      setJobs((old) => [j, ...old.filter((x) => x.id !== j.id)]);
    });
  const sendMessage = () => {
    if (
      uploading ||
      sendingLock.current ||
      composing.current ||
      (!draft.trim() && !attachment) ||
      !chat ||
      chat.deleted_at
    )
      return;
    sendingLock.current = true;
    setSending(true);
    const view = request.current;
    act(async () => {
      try {
        const signature = JSON.stringify([selected, draft, attachment?.id]);
        if (sendAttempt.current?.signature !== signature)
          sendAttempt.current = { signature, key: crypto.randomUUID() };
        await api(`/conversations/${selected}/send`, "POST", {
          text: draft,
          assetId: attachment?.id,
          revision: chat.revision,
          idempotencyKey: sendAttempt.current.key,
        });
        sendAttempt.current = null;
        if (request.current === view) {
          setDraft("");
          setAttachment(null);
          setEmojiOpen(false);
        }
        notify("已加入发送队列");
      } finally {
        sendingLock.current = false;
        setSending(false);
      }
    });
  };
  useEffect(() => {
    if (editor.current) {
      editor.current.style.height = "auto";
      editor.current.style.height =
        Math.min(editor.current.scrollHeight, 144) + "px";
    }
  }, [draft, selected]);
  const saveDraft = () =>
    selected &&
    act(async () => {
      const d = await api(`/conversations/${selected}/draft`, "PUT", {
        text: draft,
        revision: draftRevision,
      });
      setDraftRevision(d.revision);
    });
  const currentJobs = jobs
    .filter(
      (x) =>
        x.conversation_id === selected &&
        ["queued", "running", "failed"].includes(x.status),
    )
    .slice(0, 3);
  const location = chat && countryOptions.find((c) => c.code === chat.country);
  return (
    <div className={"inbox-layout " + (!insight ? "hide-insight" : "")}>
      <section className="inbox-list">
        <div className="list-tools">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="搜索客户"
              placeholder="搜索客户"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="row">
            <select
              aria-label="筛选账号"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">全部可见账号</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="list-heading">
          {trash ? "回收站" : user.role === "member" ? "我的客户" : "团队客户"}
          <span>{list.length}</span>
        </div>
        <div className="customer-scroll">
          {!list.length ? (
            <Empty
              title={trash ? "回收站为空" : "暂无客户"}
              detail={
                trash
                  ? "删除的会话会显示在这里。"
                  : user.role === "member"
                    ? "管理员分配客户后，会显示在这里。"
                    : "连接 WhatsApp 并分配负责人，即可开始接待。"
              }
            />
          ) : (
            list.map((c) => (
              <button
                className={"customer " + (selected === c.id ? "selected" : "")}
                key={c.id}
                onClick={() => setSelected(c.id)}
              >
                <Avatar chat={c} />
                <div>
                  <div className="customer-title">
                    <strong>{c.name}</strong>
                    <time>{time(c.updated_at).slice(-5)}</time>
                  </div>
                  <p>{c.last_text || "暂无消息"}</p>
                  <div className="customer-meta">
                    <span>{c.account_name}</span>
                    <span>{labels[c.mode]}</span>
                  </div>
                </div>
              </button>
            ))
          )}
          {customerCursor && (
            <button className="wide" onClick={() => setCustomerCursor("")}>
              返回第一页
            </button>
          )}
          {list.length >= 50 && (
            <button
              className="wide"
              onClick={() => {
                const last = list.at(-1);
                setCustomerCursor(
                  `&before=${encodeURIComponent(last.updated_at)}&cursor=${last.id}`,
                );
              }}
            >
              下一页客户
            </button>
          )}
        </div>
      </section>
      {!chat ? (
        <div className="chat-area welcome">
          <div className="welcome-mark">
            <img src="/SmarChat.png" alt="Rosa" />
          </div>
          <h2>让对话持续向前</h2>
          <p>选择一位客户，查看消息与客户洞察。</p>
          <div className="workspace-status">
            <ShieldCheck size={16} /> 仅向您展示获授权的客户
          </div>
        </div>
      ) : (
        <>
          <section className="chat-area">
            <div className="chat-header">
              <Avatar chat={chat} />
              <div className="grow">
                <h2>{chat.name}</h2>
                <div className="subline">
                  {viewers.length > 0 && (
                    <span>
                      {viewers.map((v) => v.name).join("、")} 正在查看
                    </span>
                  )}
                  <span>
                    {chat.presence_at &&
                    Date.now() - new Date(chat.presence_at).getTime() < 60000
                      ? (
                          {
                            available: "在线",
                            composing: "正在输入",
                            recording: "正在录音",
                          } as any
                        )[chat.presence] || ""
                      : "状态不可见"}
                  </span>
                  {chat.country && (
                    <span>
                      {countryName(chat.country)}
                      {location?.zones.length === 1
                        ? " · " + localClock(location.zones[0])
                        : ""}
                    </span>
                  )}
                </div>
              </div>
              <div className={`reception-control reception-${chat.mode}`}>
                <div className="reception-symbol" aria-hidden="true">
                  {chat.mode === "AUTO" ? (
                    <Sparkles size={19} />
                  ) : chat.mode === "HUMAN" ? (
                    <Users size={19} />
                  ) : (
                    <Pause size={19} />
                  )}
                </div>
                <div className="reception-copy" aria-hidden="true">
                  <span>接待模式</span>
                  <strong>
                    {chat.mode === "AUTO"
                      ? "自动接待"
                      : chat.mode === "HUMAN"
                        ? "人工接待"
                        : "已暂停"}
                  </strong>
                </div>
                <ChevronDown
                  className="reception-chevron"
                  size={16}
                  aria-hidden="true"
                />
                <select
                  aria-label="接待模式"
                  title="切换接待模式"
                  value={chat.mode}
                  disabled={!!chat.deleted_at}
                  onChange={(e) => update({ mode: e.target.value })}
                >
                  <option value="AUTO">自动接待</option>
                  <option value="HUMAN">人工接待</option>
                  <option value="PAUSED">暂停接待</option>
                </select>
              </div>
              <button
                className="icon"
                title="客户洞察"
                onClick={() => setInsight(!insight)}
              >
                <PanelRightClose size={19} />
              </button>
            </div>
            <div className="messages">
              <button
                className="load-history"
                onClick={() =>
                  act(async () => {
                    if (!messages.length) return;
                    const first = messages[0],
                      m = await api(
                        `/conversations/${selected}/messages?before=${encodeURIComponent(first.sent_at)}&cursor=${first.id}`,
                      );
                    setMessages([...m, ...messages]);
                    setOlder(true);
                    if (!m.length) notify("已显示全部历史消息");
                  })
                }
              >
                加载更早消息
              </button>
              {messages.map((m) => (
                <div className={"message " + m.direction} key={m.id}>
                  <div className="bubble">
                    {m.asset_id &&
                      (m.kind === "audio" ? (
                        <audio
                          controls
                          preload="none"
                          className="message-audio"
                          src={`/api/assets/${m.asset_id}/content`}
                        >
                          您的浏览器不支持音频播放。
                        </audio>
                      ) : m.kind === "image" ? (
                        <img
                          className="message-image"
                          src={`/api/assets/${m.asset_id}/content`}
                          onClick={() =>
                            setPreview({
                              id: m.asset_id,
                              name: m.asset_name,
                              mime: m.asset_mime,
                              preview_id: m.asset_preview_id,
                            })
                          }
                          alt={m.asset_name || "客户图片"}
                        />
                      ) : (
                        <button
                          className="file-bubble"
                          onClick={() =>
                            setPreview({
                              id: m.asset_id,
                              name: m.asset_name,
                              mime: m.asset_mime,
                              preview_id: m.asset_preview_id,
                            })
                          }
                        >
                          <FileText size={22} />
                          {m.asset_name || "附件"}
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    {m.kind === "audio" && (
                      <div className="audio-caption">
                        {!m.asset_id ? (
                          "语音文件暂不可用"
                        ) : m.text ? (
                          "语音转写"
                        ) : (
                          <button
                            disabled={jobs.some(
                              (j) =>
                                j.kind === "transcribe" &&
                                j.payload?.messageId === m.id &&
                                ["queued", "running"].includes(j.status),
                            )}
                            onClick={() => job("transcribe", m.id)}
                          >
                            转文字
                          </button>
                        )}
                      </div>
                    )}
                    {m.text && <div className="message-text">{m.text}</div>}
                    {m.translation && (
                      <div className="translation">{m.translation}</div>
                    )}
                    <div className="message-footer">
                      <time>{time(m.sent_at)}</time>
                      {m.direction === "out" ? (
                        <Check size={12} />
                      ) : (
                        m.text && (
                          <button onClick={() => job("translate", m.id)}>
                            翻译
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {outbox
                .filter((o) => o.status !== "sent" && o.status !== "cancelled")
                .map((o) => (
                  <div className="outbox-line" key={o.id}>
                    <span>{o.text.slice(0, 80)}</span>
                    <Badge value={o.status} />
                  </div>
                ))}
              <div ref={messageEnd} />
            </div>
            {currentJobs.length > 0 && (
              <div className="job-strip">
                {currentJobs.map((j) => (
                  <div key={j.id}>
                    <span>
                      {labels[j.kind]} · {j.error || labels[j.status]}
                    </span>
                    {j.status !== "failed" && (
                      <button
                        onClick={() =>
                          act(() => api(`/jobs/${j.id}/cancel`, "POST", {}))
                        }
                      >
                        取消
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {chat.deleted_at ? (
              <div className="composer">
                <button onClick={() => update({ deleted: false })}>
                  恢复会话（暂停接待）
                </button>
              </div>
            ) : (
              <div className="composer">
                {attachment && (
                  <div className="attachment-chip">
                    {attachment.name}
                    <button onClick={() => setAttachment(null)}>移除</button>
                  </div>
                )}
                <div className="composer-main">
                  <button
                    className="composer-add"
                    title="添加文件或图片"
                    aria-label="添加文件或图片"
                    disabled={sending}
                    onClick={() => file.current?.click()}
                  >
                    <Plus size={25} />
                  </button>
                  <div className="composer-pill">
                    <textarea
                      ref={editor}
                      rows={1}
                      aria-label="发送框"
                      value={draft}
                      disabled={sending}
                      onCompositionStart={() => {
                        composing.current = true;
                      }}
                      onCompositionEnd={() => {
                        composing.current = false;
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing &&
                          !composing.current &&
                          e.keyCode !== 229
                        ) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="输入消息…"
                    />
                    <button
                      className="composer-emoji"
                      title="插入表情"
                      aria-label="插入表情"
                      aria-expanded={emojiOpen}
                      disabled={sending}
                      onClick={() => setEmojiOpen(!emojiOpen)}
                    >
                      <Smile size={24} />
                    </button>
                    {emojiOpen && (
                      <div
                        className="emoji-picker"
                        role="group"
                        aria-label="常用表情"
                      >
                        {["😊", "👍", "🙏", "✅", "👋", "🎉", "🤝", "📦"].map(
                          (emoji) => (
                            <button
                              key={emoji}
                              aria-label={`插入 ${emoji}`}
                              onClick={() => {
                                const el = editor.current,
                                  start = el?.selectionStart ?? draft.length,
                                  end = el?.selectionEnd ?? draft.length;
                                setDraft(
                                  draft.slice(0, start) +
                                    emoji +
                                    draft.slice(end),
                                );
                                setEmojiOpen(false);
                                requestAnimationFrame(() => {
                                  el?.focus();
                                  el?.setSelectionRange(
                                    start + emoji.length,
                                    start + emoji.length,
                                  );
                                });
                              }}
                            >
                              {emoji}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    className="composer-send"
                    title="发送（Enter）"
                    aria-label="发送"
                    disabled={
                      sending || uploading || (!draft.trim() && !attachment)
                    }
                    onClick={sendMessage}
                  >
                    <Send size={22} />
                  </button>
                </div>
                <div className="compose-actions">
                  <div className="row">
                    <input
                      ref={file}
                      hidden
                      type="file"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          act(async () => {
                            setUploading(true);
                            const view = request.current;
                            try {
                              const form = new FormData();
                              form.append("file", f);
                              const uploaded = await api(
                                `/assets?conversation=${selected}`,
                                "POST",
                                form,
                              );
                              if (request.current === view)
                                setAttachment(uploaded);
                            } finally {
                              setUploading(false);
                            }
                          });
                        e.target.value = "";
                      }}
                    />
                    <button className="subtle" onClick={() => job("reply")}>
                      <Sparkles size={16} />
                      生成回复
                    </button>
                    <button className="link" onClick={saveDraft}>
                      保存草稿
                    </button>
                  </div>
                  <span className="composer-hint">
                    Enter 发送 · Shift+Enter 换行
                  </span>
                </div>
              </div>
            )}
          </section>
          {insight && (
            <aside className="insights">
              <div className="panel-heading">
                <h3>客户洞察</h3>
                <button className="subtle" onClick={() => job("analyze")}>
                  <Sparkles size={15} />
                  分析
                </button>
              </div>
              <div className="insight-scroll">
                <div className="section-label">客户资料</div>
                <Field label="国家">
                  <span>
                    {chat.country ? countryName(chat.country) : "未识别"}
                  </span>
                </Field>
                {user.role !== "member" && (
                  <Field label="负责人">
                    <span>
                      {users.find((u) => u.id === chat.assignee_id)?.name ||
                        "待分配"}
                    </span>
                  </Field>
                )}
                <div className="section-label">客户评分</div>
                {chat.analysis?.scores ? (
                  <>
                    <div className="score-total">
                      {chat.analysis.scores.total ?? "—"}
                      <small>/ 100 · {chat.analysis.scores.grade}</small>
                    </div>
                    {chat.analysis.scores.dimensions.map((d: any) => (
                      <div className="dimension" key={d.label}>
                        <span>{d.label}</span>
                        <b>{d.value ?? "未知"}</b>
                        <div>
                          <i style={{ width: `${d.value || 0}%` }} />
                        </div>
                      </div>
                    ))}
                    <small className="muted">
                      已分析 {chat.analysis.coverage?.messages} 条近期消息
                    </small>
                  </>
                ) : (
                  <p className="muted">分析对话后显示评分。</p>
                )}
                <div className="section-label">核心需求</div>
                {chat.analysis ? (
                  <>
                    <p>{chat.analysis.summary}</p>
                    <ul>
                      {chat.analysis.needs.map((n: string, i: number) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                    <div className="section-label">下一步</div>
                    <ol>
                      {chat.analysis.nextSteps.map((n: string, i: number) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <p className="muted">尚无客户分析。</p>
                )}
                <button className="wide" onClick={() => job("summary")}>
                  分析更早历史
                </button>
                {chat.summary && (
                  <small>历史已覆盖 {chat.summary.covered} 条消息</small>
                )}

                {!chat.deleted_at && (
                  <button
                    className="danger link"
                    onClick={() => {
                      if (confirm("将会话移入回收站并停止接待？"))
                        update({ deleted: true });
                    }}
                  >
                    <Trash2 size={14} />
                    删除会话
                  </button>
                )}
              </div>
            </aside>
          )}
        </>
      )}
      {preview && <Preview asset={preview} close={() => setPreview(null)} />}
    </div>
  );
}
function Avatar({ chat }: any) {
  const online =
    chat.presence === "available" &&
    Date.now() - new Date(chat.presence_at).getTime() < 60000;
  return (
    <span className="avatar">
      {chat.avatar_id ? (
        <img src={`/api/assets/${chat.avatar_id}/content`} alt="" />
      ) : (
        chat.name?.slice(0, 1)
      )}
      {online && <i />}
    </span>
  );
}
function Preview({ asset, close }: any) {
  const url = `/api/assets/${asset.preview_id || asset.id}/content`;
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-heading">
          <strong>{asset.name}</strong>
          <div className="row">
            <a
              className="button"
              href={`/api/assets/${asset.id}/content?download=true`}
              target="_blank"
            >
              <Download size={16} />
              下载
            </a>
            <button onClick={close}>关闭</button>
          </div>
        </div>
        {asset.mime?.startsWith("image/") ? (
          <img className="preview-image" src={url} />
        ) : asset.preview_id || asset.mime === "application/pdf" ? (
          <PdfPreview url={url} />
        ) : asset.mime === "text/plain" ? (
          <iframe title={asset.name} src={url} />
        ) : (
          <Empty title="此文件暂未生成预览" detail="可下载原文件查看。" />
        )}
      </div>
    </div>
  );
}
function LibraryPage({ user, tick, act, notify }: any) {
  const [folders, setFolders] = useState<any[]>([]),
    [folder, setFolder] = useState(""),
    [assets, setAssets] = useState<any[]>([]),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [preview, setPreview] = useState<any>(null),
    [edit, setEdit] = useState<any>(null),
    [selected, setSelected] = useState<string[]>([]);
  const upload = useRef<HTMLInputElement>(null),
    isAdmin = user.role !== "member";
  useEffect(() => {
    api("/folders").then(setFolders).catch(notify);
  }, [tick]);
  useEffect(() => {
    api(`/assets?folder=${folder}&q=${encodeURIComponent(q)}&offset=${offset}`)
      .then(setAssets)
      .catch(notify);
  }, [folder, q, offset, tick]);
  const patch = (id: string, b: any) => api(`/assets/${id}`, "PATCH", b);
  return (
    <div className="page library-page">
      <aside className="folder-list">
        <div className="panel-heading">
          <h3>资料分类</h3>
          {isAdmin && (
            <button
              className="icon"
              title="新建分类"
              onClick={() => {
                const name = prompt("分类名称");
                if (name) act(() => api("/folders", "POST", { name }));
              }}
            >
              <Plus size={18} />
            </button>
          )}
        </div>
        <button
          className={!folder ? "active" : ""}
          onClick={() => {
            setFolder("");
            setOffset(0);
          }}
        >
          全部资料
        </button>
        {folders.map((f) => (
          <div className="row" key={f.id}>
            <button
              className={folder === f.id ? "active grow" : "grow"}
              onClick={() => {
                setFolder(f.id);
                setOffset(0);
              }}
            >
              <Library size={16} />
              {f.name}
            </button>
            {isAdmin && folder === f.id && (
              <button
                className="icon"
                title="删除分类，文件保留"
                onClick={() =>
                  act(async () => {
                    await api(`/folders/${f.id}`, "DELETE");
                    setFolder("");
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </aside>
      <section className="library-files">
        <div className="page-heading">
          <div>
            <h2>
              {folders.find((x) => x.id === folder)?.name || "团队资料库"}
            </h2>
            <p>团队共享资料，按分类管理。</p>
          </div>
          {isAdmin && (
            <>
              <input
                ref={upload}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  act(async () => {
                    for (const file of files) {
                      const form = new FormData();
                      form.append("file", file);
                      await api(`/assets?folder=${folder}`, "POST", form);
                    }
                    notify(`已上传 ${files.length} 份资料`);
                  });
                  e.target.value = "";
                }}
              />
              <button
                className="primary"
                onClick={() => upload.current?.click()}
              >
                <Plus size={17} />
                上传资料
              </button>
            </>
          )}
        </div>
        <div className="table-toolbar">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="搜索资料"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
              placeholder="搜索文件名"
            />
          </div>
          {isAdmin && selected.length > 0 && (
            <select
              aria-label="批量移动"
              value=""
              onChange={(e) =>
                act(async () => {
                  for (const id of selected)
                    await patch(id, {
                      folderId:
                        e.target.value === "none" ? null : e.target.value,
                    });
                  setSelected([]);
                })
              }
            >
              <option value="">移动 {selected.length} 份资料至…</option>
              <option value="none">未分类</option>
              {folders.map((f) => (
                <option value={f.id} key={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>文件</th>
                <th>大小</th>
                <th>AI 读取</th>
                <th>用于回复</th>
                <th>原件外发</th>
                <th>处理状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${a.name}`}
                      checked={selected.includes(a.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, a.id]
                            : selected.filter((x) => x !== a.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button className="file-name" onClick={() => setPreview(a)}>
                      <FileText size={18} />
                      {a.name}
                    </button>
                  </td>
                  <td>{(a.bytes / 1024).toFixed(0)} KB</td>
                  {[
                    ["ai_readable", "aiReadable"],
                    ["reply_usable", "replyUsable"],
                    ["external", "external"],
                  ].map(([key, field]) => (
                    <td key={key}>
                      <input
                        aria-label={`${a.name} ${field}`}
                        type="checkbox"
                        disabled={!isAdmin}
                        checked={a[key]}
                        onChange={(e) =>
                          act(() => patch(a.id, { [field]: e.target.checked }))
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <span className="muted">
                      {(
                        {
                          ready: "已提取",
                          pending: "处理中",
                          needs_text: "待补充文本",
                        } as any
                      )[a.extraction_status] || a.extraction_status}
                    </span>
                  </td>
                  <td>
                    {isAdmin && (
                      <button
                        onClick={() =>
                          act(async () => {
                            const t = await api(`/assets/${a.id}/text`);
                            setEdit({ ...a, text: t.extracted_text });
                          })
                        }
                      >
                        编辑
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!assets.length && (
            <Empty
              title="暂无资料"
              detail="上传产品说明、规格或常见问题，供 AI 回复时使用。"
            />
          )}
        </div>
        <div className="pagination">
          <span>第 {Math.floor(offset / 50) + 1} 页</span>
          <button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            上一页
          </button>
          <button
            disabled={assets.length < 50}
            onClick={() => setOffset(offset + 50)}
          >
            下一页
          </button>
        </div>
      </section>
      {preview && <Preview asset={preview} close={() => setPreview(null)} />}{" "}
      {edit && (
        <div className="modal-backdrop">
          <div className="edit-modal">
            <h3>{edit.name}</h3>
            <Field label="AI 可读取文本">
              <textarea
                rows={16}
                value={edit.text}
                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
              />
            </Field>
            <div className="row">
              <button
                className="primary"
                onClick={() =>
                  act(async () => {
                    await patch(edit.id, { text: edit.text });
                    setEdit(null);
                  })
                }
              >
                保存
              </button>
              <button onClick={() => setEdit(null)}>取消</button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm("删除这份资料？"))
                    act(async () => {
                      await api(`/assets/${edit.id}`, "DELETE");
                      setEdit(null);
                    });
                }}
              >
                删除文件
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function AnalyticsPage({ user, tick, notify }: any) {
  const [period, setPeriod] = useState("week"),
    [report, setReport] = useState<any>(null),
    [owner, setOwner] = useState(""),
    [members, setMembers] = useState<any[]>([]);
  useEffect(() => {
    if (user.role === "superadmin")
      api("/users").then(setMembers).catch(notify);
  }, []);
  useEffect(() => {
    api(`/analytics?period=${period}&owner=${owner}`)
      .then(setReport)
      .catch(notify);
  }, [period, tick, owner]);
  return (
    <div className="page analytics-page">
      <div className="page-heading">
        <div>
          <h2>客户分析{period === "week" ? "周报" : "月报"}</h2>
          <p>
            {user.role === "superadmin"
              ? "全团队数据 · Bison01 独立分析"
              : "仅本人负责的客户与个人分析"}
          </p>
        </div>
        {user.role === "superadmin" && (
          <Field label="分析范围">
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Bison01 · 全团队独立分析</option>
              {members
                .filter((u) => u.role === "member")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} · 成员分析（只读）
                  </option>
                ))}
            </select>
          </Field>
        )}
        <div className="segmented">
          {[
            ["week", "周报"],
            ["month", "月报"],
          ].map(([v, n]) => (
            <button
              className={period === v ? "active" : ""}
              onClick={() => setPeriod(v)}
              key={v}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      {report && (
        <>
          <div className="stats">
            {[
              ["可见客户", report.customers.total],
              ["新增客户", report.customers.new],
              ["自动接待客户", report.customers.automatic],
            ].map(([n, v]) => (
              <div key={n}>
                <span>{n}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <div className="report-grid">
            <section className="card">
              <h3>新增客户趋势</h3>
              <div className="chart">
                {report.trends.length ? (
                  report.trends.map((t: any) => (
                    <div className="chart-column" key={t.date}>
                      <b>{t.count}</b>
                      <div
                        style={{
                          height: Math.max(
                            4,
                            (130 * t.count) /
                              Math.max(
                                ...report.trends.map((x: any) => x.count),
                              ),
                          ),
                        }}
                      />
                      <small>{t.date.slice(5)}</small>
                    </div>
                  ))
                ) : (
                  <Empty title="本期暂无新增客户" />
                )}
              </div>
            </section>
            <section className="card">
              <h3>客户问题分类</h3>
              {report.topics.length ? (
                report.topics.map((t: any) => (
                  <div className="topic" key={t.label}>
                    <span>{t.label}</span>
                    <div>
                      <i
                        style={{
                          width: `${(t.count / Math.max(...report.topics.map((x: any) => x.count))) * 100}%`,
                        }}
                      />
                    </div>
                    <b>{t.count}</b>
                  </div>
                ))
              ) : (
                <Empty title="暂无可分类的文字消息" />
              )}
            </section>
          </div>
          <section className="card">
            <h3>客户需求与下一步</h3>
            {report.needs.length ? (
              report.needs.map((n: any) => (
                <div className="report-customer" key={n.id}>
                  <b>{n.name}</b>
                  <p>{n.analysis.summary}</p>
                  <span>{n.analysis.nextSteps?.join("；")}</span>
                </div>
              ))
            ) : (
              <Empty
                title="暂无客户分析"
                detail="在客户洞察中运行分析后，需求摘要会显示在这里。"
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
function AccountsPage({ tick, act, notify }: any) {
  const [accounts, setAccounts] = useState<any[]>([]),
    [users, setUsers] = useState<any[]>([]),
    [editing, setEditing] = useState<any>(null);
  useEffect(() => {
    Promise.all([api("/accounts"), api("/users")])
      .then(([a, u]) => {
        setAccounts(a);
        setUsers(u);
      })
      .catch(notify);
  }, [tick]);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>WhatsApp 账号</h2>
          <p>每个接入只分配一位负责人，客户和数据随接入统一转交。</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            const name = prompt("账号名称");
            if (name) act(() => api("/accounts", "POST", { name }));
          }}
        >
          <Plus size={17} />
          添加账号
        </button>
      </div>
      <div className="accounts-grid">
        {accounts.map((a) => (
          <section className="card account-card" key={a.id}>
            <div className="panel-heading">
              <Smartphone size={23} />
              <Badge value={a.status} />
            </div>
            <h3>{a.name}</h3>
            <p className="muted">
              {a.phone?.split("@")[0] || "等待关联 WhatsApp"}
            </p>
            {a.qr && (
              <img className="qr" src={a.qr} alt={`${a.name} WhatsApp 扫码`} />
            )}
            <div className="account-info">
              <span>负责人</span>
              <b>{users.find((u) => u.id === a.owner_id)?.name || "未分配"}</b>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={a.auto_reply}
                onChange={(e) =>
                  act(() =>
                    api(`/accounts/${a.id}`, "PATCH", {
                      autoReply: e.target.checked,
                    }),
                  )
                }
              />
              自动接待
            </label>
            <div className="row">
              <button
                className={a.enabled ? "" : "primary"}
                onClick={() =>
                  act(() =>
                    api(`/accounts/${a.id}`, "PATCH", { enabled: !a.enabled }),
                  )
                }
              >
                {a.enabled ? "断开连接" : "连接 / 获取二维码"}
              </button>
              <button
                onClick={() =>
                  act(async () => {
                    const grants = await api(`/accounts/${a.id}/grants`);
                    setEditing({ ...a, grants });
                  })
                }
              >
                分配与规则
              </button>
            </div>
          </section>
        ))}
      </div>
      {!accounts.length && (
        <Empty
          title="添加第一个 WhatsApp 账号"
          detail="创建后扫码关联，并分配负责员工。"
        />
      )}
      {editing && (
        <div className="modal-backdrop">
          <div className="edit-modal">
            <h3>{editing.name}</h3>
            <Field label="负责人">
              <select
                value={editing.owner_id || ""}
                onChange={(e) =>
                  setEditing({ ...editing, owner_id: e.target.value })
                }
              >
                <option value="">待分配</option>
                {users
                  .filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
            <p className="muted">
              回复规则由负责人在“对话规则”中独立设置，转交后使用新负责人的规则。
            </p>
            <div className="row">
              <button
                className="primary"
                onClick={() =>
                  act(async () => {
                    await api(`/accounts/${editing.id}`, "PATCH", {
                      ownerId: editing.owner_id || null,
                    });
                    setEditing(null);
                  })
                }
              >
                保存分配
              </button>
              <button onClick={() => setEditing(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function UsersPage({ user, tick, act, notify }: any) {
  const [users, setUsers] = useState<any[]>([]),
    [accounts, setAccounts] = useState<any[]>([]),
    [form, setForm] = useState<any>(null),
    [secret, setSecret] = useState(""),
    [deleting, setDeleting] = useState<any>(null),
    [confirmation, setConfirmation] = useState(""),
    [password, setPassword] = useState(""),
    [deletingBusy, setDeletingBusy] = useState(false);
  const load = () =>
    Promise.all([api("/users"), api("/accounts")])
      .then(([u, a]) => {
        setUsers(u);
        setAccounts(a);
      })
      .catch(notify);
  useEffect(() => {
    void load();
  }, [tick]);
  const available = Array.from(
    { length: 6 },
    (_, i) => `Bison0${i + 2}`,
  ).filter((n) => !users.some((u) => u.username === n));
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>团队账号</h2>
          <p>
            1 位超管 · 6 个成员席位。成员数据互不可见，分析结果按账号独立保存。
          </p>
        </div>
        <button
          className="primary"
          disabled={!available.length}
          onClick={() =>
            setForm({ username: available[0], name: available[0], email: "" })
          }
        >
          <Plus size={17} />
          创建成员
        </button>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>账号 / 姓名</th>
              <th>角色与范围</th>
              <th>负责接入</th>
              <th>状态</th>
              <th>管理</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <b>{u.username}</b>
                  <p>{u.name !== u.username ? u.name : ""}</p>
                </td>
                <td>
                  {u.role === "superadmin"
                    ? "超级管理员 · 全团队"
                    : "成员 · 仅本人数据"}
                </td>
                <td>
                  {accounts
                    .filter((a) => a.owner_id === u.id)
                    .map((a) => a.name)
                    .join("、") || "未分配"}
                </td>
                <td>{u.active ? "启用" : "停用"}</td>
                <td>
                  <div className="row">
                    <button
                      disabled={u.role === "superadmin"}
                      onClick={() =>
                        act(async () => {
                          await api(`/users/${u.id}`, "PATCH", {
                            active: !u.active,
                          });
                          await load();
                        })
                      }
                    >
                      {u.active ? "停用" : "启用"}
                    </button>
                    <button
                      onClick={() =>
                        act(async () => {
                          const r = await api(
                            `/users/${u.id}/reset`,
                            "POST",
                            {},
                          );
                          setSecret(
                            `一次性密码重置令牌（30 分钟内有效）：\n${r.resetToken}`,
                          );
                        })
                      }
                    >
                      重置密码
                    </button>
                    {u.role === "member" && (
                      <button
                        className="danger"
                        onClick={() =>
                          act(async () => {
                            const data = await api(
                              `/users/${u.id}/deletion-preview`,
                            );
                            setConfirmation("");
                            setPassword("");
                            setDeleting(data);
                          })
                        }
                      >
                        删除
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        在 WhatsApp
        模块分配负责人；接入转交后，其全部客户随之转交。重新启用成员不会自动重新开启接待。
      </p>
      {form && (
        <div className="modal-backdrop">
          <form
            className="edit-modal"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                const r = await api("/users", "POST", form);
                setForm(null);
                setSecret(
                  `用户名：${r.user.username}\n临时密码：${r.temporaryPassword}\n首次登录请修改密码。`,
                );
                await load();
              });
            }}
          >
            <h3>创建成员席位</h3>
            <Field label="账号">
              <select
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              >
                {available.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="姓名">
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <div className="row">
              <button className="primary">创建账号</button>
              <button type="button" onClick={() => setForm(null)}>
                取消
              </button>
            </div>
          </form>
        </div>
      )}
      {deleting && (
        <div className="modal-backdrop">
          <form
            className="edit-modal"
            role="dialog"
            aria-label="删除团队成员"
            onSubmit={async (e) => {
              e.preventDefault();
              setDeletingBusy(true);
              try {
                const r = await api(`/users/${deleting.id}`, "DELETE", {
                  confirmation,
                  currentPassword: password,
                });
                setDeleting(null);
                setPassword("");
                await load();
                notify(
                  r.pendingFiles === 0
                    ? "成员账号及独占数据已清空"
                    : "账号已删除，附件正在后台清理",
                );
              } catch (e) {
                notify(e);
              } finally {
                setDeletingBusy(false);
              }
            }}
          >
            <h3>永久删除 {deleting.username}</h3>
            <p>
              将清空 {deleting.accounts} 个接入、{deleting.customers} 位客户、
              {deleting.messages} 条消息和 {deleting.files}{" "}
              个附件，以及该成员的登录态、草稿和分析。
            </p>
            <p>
              公司共享资料、其他成员与超管数据保留。历史备份不随本操作改写；当前工作区无法撤销此操作。
            </p>
            <Field label={`输入 ${deleting.username} 确认删除`}>
              <input
                autoComplete="off"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </Field>
            <Field label="超管当前密码">
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <div className="row">
              <button
                className="danger"
                disabled={
                  deletingBusy ||
                  confirmation !== deleting.username ||
                  !password
                }
              >
                {deletingBusy ? "正在清空…" : "确认删除并清空"}
              </button>
              <button
                type="button"
                disabled={deletingBusy}
                onClick={() => {
                  setDeleting(null);
                  setPassword("");
                }}
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}
      {secret && (
        <div className="modal-backdrop">
          <div className="edit-modal">
            <h3>请交给对应成员</h3>
            <pre className="secret">{secret}</pre>
            <button onClick={() => setSecret("")}>已保存</button>
          </div>
        </div>
      )}
    </div>
  );
}
function SettingsPage({ user, tick, act, notify }: any) {
  const [tab, setTab] = useState("rules"),
    [settings, setSettings] = useState<any>(null),
    [providers, setProviders] = useState<any[]>([]),
    [provider, setProvider] = useState<any>(null),
    [audits, setAudits] = useState<any[]>([]),
    [jobs, setJobs] = useState<any[]>([]);
  useEffect(() => {
    api("/settings").then(setSettings).catch(notify);
  }, []);
  useEffect(() => {
    api("/providers").then(setProviders).catch(notify);
    api("/jobs").then(setJobs).catch(notify);
    if (tab === "audit") api("/audit").then(setAudits).catch(notify);
  }, [tick, tab]);
  const set = (k: string, v: any) =>
    setSettings({ ...settings, value: { ...settings.value, [k]: v } });
  return (
    <div className="page settings-page">
      <div className="tabs">
        {[
          ["rules", "对话规则"],
          ["providers", "AI 接口"],
          ["backup", "备份与恢复"],
          ["audit", "操作审计"],
        ]
          .filter(([k]) => user.role === "superadmin" || k === "rules")
          .map(([k, n]) => (
            <button
              key={k}
              className={tab === k ? "active" : ""}
              onClick={() => setTab(k)}
            >
              {n}
            </button>
          ))}
      </div>
      {tab === "rules" && settings && (
        <>
          <div className="page-heading">
            <div>
              <h2>对话规则</h2>
              <p>设置本人负责客户的回复规则与接待方式。</p>
            </div>
            <button
              className="primary"
              onClick={() =>
                act(async () => {
                  await api("/settings", "PUT", settings);
                  setSettings(await api("/settings"));
                  notify("规则已保存");
                })
              }
            >
              保存规则
            </button>
          </div>
          <div className="settings-grid">
            <section className="card">
              <h3>回复方式</h3>
              <Field label="默认 AI 接口">
                <select
                  value={settings.value.providerId}
                  onChange={(e) => set("providerId", e.target.value)}
                >
                  <option value="">请选择</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.tested ? "" : " · 未测试"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="语音转写接口">
                <select
                  value={settings.value.transcriptionProviderId || ""}
                  onChange={(e) =>
                    set("transcriptionProviderId", e.target.value)
                  }
                >
                  <option value="">跟随默认 AI 接口</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="语音转写模型">
                <input
                  value={settings.value.transcriptionModel || "whisper-1"}
                  onChange={(e) => set("transcriptionModel", e.target.value)}
                />
              </Field>
              <p className="muted">
                接口需支持语音转写；识别结果可用于翻译、分析和生成回复。
              </p>
              <Field label="回复语气">
                <input
                  value={settings.value.tone}
                  onChange={(e) => set("tone", e.target.value)}
                />
              </Field>
              <Field label="回复语言">
                <input
                  value={settings.value.language}
                  onChange={(e) => set("language", e.target.value)}
                />
              </Field>
              <Field label="每个账号每小时自动回复上限">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={settings.value.maxRepliesPerHour}
                  onChange={(e) =>
                    set("maxRepliesPerHour", Number(e.target.value))
                  }
                />
              </Field>
            </section>
            <section className="card">
              <h3>公司信息与边界</h3>
              <Field label="公司与产品信息">
                <textarea
                  rows={5}
                  value={settings.value.companyInfo}
                  onChange={(e) => set("companyInfo", e.target.value)}
                />
              </Field>
              <Field label="回复规则">
                <textarea
                  rows={5}
                  value={settings.value.boundaries}
                  onChange={(e) => set("boundaries", e.target.value)}
                />
              </Field>
            </section>
            <section className="card full">
              <h3>自动接待授权</h3>
              {[
                [
                  "cloudConsent",
                  "允许将当前客户对话及相关资料发送到配置的 AI 接口",
                ],
                [
                  "riskConsent",
                  "启用个人版 WhatsApp 自动接待，已了解关联设备接入方式",
                ],
                ["globalAuto", "开启本人客户自动接待"],
              ].map(([k, n]) => (
                <label className="check-field" key={k}>
                  <input
                    type="checkbox"
                    checked={settings.value[k]}
                    onChange={(e) => set(k, e.target.checked)}
                  />
                  {n}
                </label>
              ))}
              <p className="muted">
                账号自动接待开关及客户接待模式同时生效；历史消息不会补发。
              </p>
            </section>
          </div>
        </>
      )}
      {tab === "providers" && (
        <>
          <div className="page-heading">
            <div>
              <h2>AI 接口</h2>
              <p>兼容聊天接口，密钥加密保存。</p>
            </div>
            <button
              className="primary"
              onClick={() =>
                setProvider({
                  name: "",
                  baseUrl: "https://api.openai.com/v1",
                  model: "",
                  apiKey: "",
                })
              }
            >
              <Plus size={17} />
              添加接口
            </button>
          </div>
          <div className="accounts-grid">
            {providers.map((p) => (
              <section className="card" key={p.id}>
                <h3>{p.name}</h3>
                <p>{p.model}</p>
                <p className="muted break">{p.base_url}</p>
                <Badge value={p.tested ? "测试通过" : "未测试"} />
                <div className="row spacer">
                  <button
                    onClick={() =>
                      act(() => api(`/providers/${p.id}/test`, "POST", {}))
                    }
                  >
                    测试连接
                  </button>
                  <button
                    onClick={() =>
                      setProvider({
                        id: p.id,
                        name: p.name,
                        baseUrl: p.base_url,
                        model: p.model,
                        apiKey: "",
                      })
                    }
                  >
                    编辑
                  </button>
                </div>
              </section>
            ))}
          </div>
          {jobs
            .filter((j) => j.kind === "provider_test")
            .slice(0, 3)
            .map((j) => (
              <p key={j.id}>
                {labels[j.kind]} · {j.error || labels[j.status]}
              </p>
            ))}
        </>
      )}
      {tab === "backup" && (
        <BackupPanel user={user} act={act} notify={notify} />
      )}
      {tab === "audit" && (
        <section className="card table-wrap">
          <h2>操作审计</h2>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>操作</th>
                <th>对象</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td>{time(a.created_at)}</td>
                  <td>{a.user_name || "系统"}</td>
                  <td>{a.action}</td>
                  <td className="mono">{a.resource || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {provider && (
        <div className="modal-backdrop">
          <form
            className="edit-modal"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await api("/providers", "POST", provider);
                setProvider(null);
              });
            }}
          >
            <h3>{provider.id ? "编辑" : "添加"} AI 接口</h3>
            {[
              ["name", "名称"],
              ["baseUrl", "接口地址"],
              ["model", "模型"],
              ["apiKey", provider.id ? "新密钥（留空保留）" : "API 密钥"],
            ].map(([k, n]) => (
              <Field key={k} label={n}>
                <input
                  required={k !== "apiKey" || !provider.id}
                  type={k === "apiKey" ? "password" : "text"}
                  value={provider[k]}
                  onChange={(e) =>
                    setProvider({ ...provider, [k]: e.target.value })
                  }
                />
              </Field>
            ))}
            <div className="row">
              <button className="primary">保存接口</button>
              <button type="button" onClick={() => setProvider(null)}>
                取消
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function BackupPanel({ user, act, notify }: any) {
  const [password, setPassword] = useState(""),
    [auth, setAuth] = useState(""),
    [runs, setRuns] = useState<any[]>([]);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (user.role !== "superadmin") return;
    const load = () =>
      api("/backups")
        .then(setRuns)
        .catch(() => {});
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [user.role]);
  return (
    <section className="card backup-panel">
      <h2>全数据备份与恢复</h2>
      <p>包括团队账号、分配、聊天、附件、AI 配置和 WhatsApp 认证。</p>
      {user.role === "superadmin" ? (
        <>
          <Field label="备份包密码（至少 12 个字符）">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="当前登录密码">
            <input
              type="password"
              value={auth}
              onChange={(e) => setAuth(e.target.value)}
            />
          </Field>
          <div className="row">
            <button
              className="primary"
              onClick={() =>
                act(async () => {
                  const r = await api("/backup", "POST", {
                    password,
                    currentPassword: auth,
                  });
                  notify(r.message);
                })
              }
            >
              创建加密备份
            </button>
            <button onClick={() => file.current?.click()}>恢复备份</button>
            <input
              type="file"
              hidden
              ref={file}
              accept=".scbackup"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (
                  confirm("恢复将替换原生版全部数据并暂停自动接待。是否继续？")
                )
                  act(async () => {
                    const form = new FormData();
                    form.append("password", password);
                    form.append("currentPassword", auth);
                    form.append("file", f);
                    const r = await api("/restore", "POST", form);
                    notify(r.message);
                  });
                e.target.value = "";
              }}
            />
          </div>
          <p className="muted">
            备份文件保存在部署主机的备份卷。恢复完成后需要重新登录，自动接待保持暂停。
          </p>
          {runs.map((run) => (
            <div className="session-row" key={run.id}>
              <div>
                {run.kind === "restore" ? "恢复" : "备份"} · {time(run.at)}
                <p className="muted">{run.error || labels[run.status]}</p>
              </div>
              {run.status === "done" && run.kind === "backup" && (
                <a
                  className="button"
                  href={`/api/backups/${run.id}/download`}
                  download
                >
                  <Download size={14} />
                  下载
                </a>
              )}
            </div>
          ))}
        </>
      ) : (
        <p>仅超级管理员可以执行全系统备份与恢复。</p>
      )}
    </section>
  );
}
function ProfilePage({ user, act, notify }: any) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [sessions, setSessions] = useState<any[]>([]);
  useEffect(() => {
    api("/auth/sessions").then(setSessions).catch(notify);
  }, []);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>{user.name}</h2>
          <p>
            {labels[user.role]} · {user.username}
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await api("/auth/password", "POST", { current, password });
              setCurrent("");
              setPassword("");
              notify("密码已更新，其他会话已退出");
            });
          }}
        >
          <h3>修改密码</h3>
          <Field label="当前密码">
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="新密码（至少 6 位）">
            <input
              type="password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <button className="primary">更新密码</button>
        </form>
        <section className="card">
          <h3>登录会话</h3>
          {sessions.map((s) => (
            <div className="session-row" key={s.id}>
              <div>
                {time(s.created_at)}
                {s.current && <span className="badge">当前</span>}
              </div>
              {!s.current && (
                <button
                  onClick={() =>
                    act(async () => {
                      await api(`/auth/sessions/${s.id}`, "DELETE");
                      setSessions(await api("/auth/sessions"));
                    })
                  }
                >
                  退出会话
                </button>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
