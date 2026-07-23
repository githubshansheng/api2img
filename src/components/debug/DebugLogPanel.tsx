import {
  Activity,
  Bug,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearDebugLogs,
  formatDebugLogExport,
  getDebugLogs,
  runFrontendConnectionCheck,
  subscribeDebugLogs,
  subscribeFrontendDebugPanelOpen,
  type DebugLogCategory,
  type DebugLogEntry,
  type DebugLogLevel
} from "../../services/debug-log-service";

type LevelFilter = "all" | DebugLogLevel;
type CategoryFilter = "all" | DebugLogCategory;
type ActionStatus = "idle" | "copied" | "downloaded" | "checked";

const LEVEL_LABELS: Record<DebugLogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR"
};

const CATEGORY_LABELS: Record<DebugLogCategory, string> = {
  app: "应用",
  network: "网络",
  runtime: "运行时",
  "single-view": "单图新视角"
};

export function DebugLogPanel() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState(getDebugLogs);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [actionStatus, setActionStatus] =
    useState<ActionStatus>("idle");
  const actionTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => subscribeDebugLogs(setLogs), []);

  useEffect(
    () =>
      subscribeFrontendDebugPanelOpen(() => {
        setOpen(true);
      }),
    []
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(
    () => () => {
      if (actionTimerRef.current !== undefined) {
        window.clearTimeout(actionTimerRef.current);
      }
    },
    []
  );

  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return logs
      .filter(
        (entry) =>
          levelFilter === "all" || entry.level === levelFilter
      )
      .filter(
        (entry) =>
          categoryFilter === "all" ||
          entry.category === categoryFilter
      )
      .filter((entry) => {
        if (!normalizedQuery) {
          return true;
        }

        return [
          entry.message,
          entry.requestId,
          entry.category,
          JSON.stringify(entry.details ?? {})
        ].some((value) =>
          value?.toLocaleLowerCase().includes(normalizedQuery)
        );
      })
      .reverse();
  }, [categoryFilter, levelFilter, logs, query]);
  const errorCount = logs.filter((entry) => entry.level === "error").length;

  function showActionStatus(status: ActionStatus) {
    setActionStatus(status);

    if (actionTimerRef.current !== undefined) {
      window.clearTimeout(actionTimerRef.current);
    }

    actionTimerRef.current = window.setTimeout(() => {
      setActionStatus("idle");
      actionTimerRef.current = undefined;
    }, 1800);
  }

  async function copyLogs() {
    await navigator.clipboard.writeText(formatDebugLogExport(filteredLogs));
    showActionStatus("copied");
  }

  function downloadLogs() {
    const blob = new Blob([formatDebugLogExport(filteredLogs)], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `api2image-debug-${createFileTimestamp()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showActionStatus("downloaded");
  }

  async function checkConnection() {
    setChecking(true);

    try {
      await runFrontendConnectionCheck();
      showActionStatus("checked");
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <button
        aria-label="打开 Debug 日志"
        className="debug-log-trigger"
        onClick={() => setOpen(true)}
        title="打开前端 Debug 日志"
        type="button"
      >
        <Bug size={18} />
        <span>Debug 日志</span>
        {errorCount > 0 && (
          <strong aria-label={`${errorCount} 条错误日志`}>
            {Math.min(errorCount, 99)}
          </strong>
        )}
      </button>

      {open && (
        <div
          className="debug-log-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
            }
          }}
        >
          <section
            aria-label="前端 Debug 日志"
            aria-modal="true"
            className="debug-log-drawer"
            role="dialog"
          >
            <header className="debug-log-header">
              <div>
                <span>FRONTEND DIAGNOSTICS</span>
                <h2>Debug 日志</h2>
                <p>
                  已自动脱敏密钥、认证信息、图片数据和敏感 URL 参数。
                </p>
              </div>
              <button
                aria-label="关闭 Debug 日志"
                className="debug-log-icon-button"
                onClick={() => setOpen(false)}
                title="关闭"
                type="button"
              >
                <X size={19} />
              </button>
            </header>

            <div className="debug-log-summary">
              <span>
                <Activity size={15} />
                当前会话 {logs.length} 条
              </span>
              <span className={errorCount > 0 ? "has-errors" : ""}>
                {errorCount > 0
                  ? `${errorCount} 条错误`
                  : "未检测到前端错误"}
              </span>
              {actionStatus !== "idle" && (
                <span className="debug-log-action-status">
                  <Check size={14} />
                  {formatActionStatus(actionStatus)}
                </span>
              )}
            </div>

            <div className="debug-log-toolbar">
              <label className="debug-log-search">
                <Search size={15} />
                <input
                  aria-label="搜索 Debug 日志"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索消息、请求 ID 或详情"
                  value={query}
                />
              </label>

              <label>
                <span>级别</span>
                <select
                  aria-label="按日志级别筛选"
                  onChange={(event) =>
                    setLevelFilter(event.target.value as LevelFilter)
                  }
                  value={levelFilter}
                >
                  <option value="all">全部</option>
                  <option value="error">ERROR</option>
                  <option value="warn">WARN</option>
                  <option value="info">INFO</option>
                  <option value="debug">DEBUG</option>
                </select>
              </label>

              <label>
                <span>类别</span>
                <select
                  aria-label="按日志类别筛选"
                  onChange={(event) =>
                    setCategoryFilter(
                      event.target.value as CategoryFilter
                    )
                  }
                  value={categoryFilter}
                >
                  <option value="all">全部</option>
                  {(
                    Object.keys(
                      CATEGORY_LABELS
                    ) as DebugLogCategory[]
                  ).map((category) => (
                    <option key={category} value={category}>
                      {CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="debug-log-actions">
              <button
                disabled={checking}
                onClick={() => void checkConnection()}
                type="button"
              >
                <RefreshCw
                  className={checking ? "is-spinning" : ""}
                  size={15}
                />
                {checking ? "自检中" : "连接自检"}
              </button>
              <button
                disabled={filteredLogs.length === 0}
                onClick={() => void copyLogs()}
                type="button"
              >
                <Clipboard size={15} />
                复制 JSON
              </button>
              <button
                disabled={filteredLogs.length === 0}
                onClick={downloadLogs}
                type="button"
              >
                <Download size={15} />
                下载
              </button>
              <button
                className="is-danger"
                disabled={logs.length === 0}
                onClick={clearDebugLogs}
                type="button"
              >
                <Trash2 size={15} />
                清空
              </button>
            </div>

            <div className="debug-log-list" role="log">
              {filteredLogs.length === 0 ? (
                <div className="debug-log-empty">
                  <Bug size={24} />
                  <strong>当前筛选条件下没有日志</strong>
                  <span>运行连接自检或重新执行生成操作后会自动记录。</span>
                </div>
              ) : (
                filteredLogs.map((entry) => (
                  <DebugLogEntryRow entry={entry} key={entry.id} />
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function DebugLogEntryRow({ entry }: { entry: DebugLogEntry }) {
  return (
    <details
      className={`debug-log-entry level-${entry.level}`}
      data-debug-log-id={entry.id}
    >
      <summary>
        <span className="debug-log-level">
          {LEVEL_LABELS[entry.level]}
        </span>
        <time dateTime={entry.timestamp}>
          {formatDebugTime(entry.timestamp)}
        </time>
        <span className="debug-log-category">
          {CATEGORY_LABELS[entry.category]}
        </span>
        <strong>{entry.message}</strong>
        {entry.durationMs !== undefined && (
          <span className="debug-log-duration">
            {entry.durationMs} ms
          </span>
        )}
        <ChevronDown className="debug-log-chevron" size={16} />
      </summary>
      <div className="debug-log-entry-details">
        <dl>
          <div>
            <dt>时间</dt>
            <dd>{entry.timestamp}</dd>
          </div>
          {entry.requestId && (
            <div>
              <dt>请求 ID</dt>
              <dd>{entry.requestId}</dd>
            </div>
          )}
        </dl>
        <pre>
          {JSON.stringify(entry.details ?? { message: entry.message }, null, 2)}
        </pre>
      </div>
    </details>
  );
}

function formatDebugTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false
  }).format(date);
}

function formatActionStatus(status: Exclude<ActionStatus, "idle">) {
  switch (status) {
    case "copied":
      return "日志已复制";
    case "downloaded":
      return "日志已下载";
    case "checked":
      return "连接自检已完成";
  }
}

function createFileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
