export async function api(path: string, method = "GET", body?: any) {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "X-SmarChat": "1",
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `请求失败 ${response.status}`);
  return data;
}
export const time = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export const labels: Record<string, string> = {
  queued: "排队中",
  running: "处理中",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
  unknown: "待确认",
  sending: "发送中",
  sent: "已发送",
  connected: "已连接",
  disconnected: "未连接",
  connecting: "连接中",
  qr: "等待扫码",
  logged_out: "已退出",
  wrong_account: "账号不匹配",
  superadmin: "超级管理员",
  admin: "管理员",
  member: "成员",
  AUTO: "自动接待",
  HUMAN: "人工接待",
  PAUSED: "暂停",
  reply: "生成回复",
  auto: "自动回复",
  analyze: "客户分析",
  summary: "历史分析",
  transcribe: "语音转文字",
  translate: "翻译",
  extract: "文件处理",
  provider_test: "接口测试",
};
