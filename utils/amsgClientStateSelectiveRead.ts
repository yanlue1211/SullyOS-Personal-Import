/**
 * AMSG2 云端读取：只取界面真正需要的 key。
 *
 * ReiClient 2.10 / amsg-server 3.2 已支持 getClientState(namespace, { key })，
 * 服务端在 D1 用 key 过滤后再解密，不会为读一条状态解开整个 fire_pack。
 *
 * 一次读几个 key 时，故意分别请求（每请求各自受 Cloudflare Free 的 CPU 限制），
 * 但结果仍按原先「全成功才显示为读取成功」的语义交付。
 * 不走私有 D1/解密端点，不改变加密/鉴权或云端存储。
 */

export interface SelectedStateRow {
  key: string;
  value: string;
  updatedAt?: number;
}

export interface SelectedStateReadClient {
  getClientState(
    namespace: string,
    options: { key: string },
  ): Promise<{
    success?: boolean;
    data?: { entries?: SelectedStateRow[] };
  } | undefined>;
}

export const readSelectedClientStateEntries = async (
  client: SelectedStateReadClient,
  namespace: string,
  keys: readonly string[],
): Promise<SelectedStateRow[]> => {
  if (!keys.length) return [];

  // 一个请求只拿一个 key；五个小请求不再让 Worker 解密整份角色上下文。
  const responses = await Promise.all(keys.map((key) => client.getClientState(namespace, { key })));
  const rows: SelectedStateRow[] = [];
  for (let i = 0; i < keys.length; i++) {
    const response = responses[i];
    if (!response?.success || !Array.isArray(response.data?.entries)) {
      throw new Error('按键读取云端状态失败：本次结果不完整');
    }
    // 防止旧网关返回了整个 namespace 时把无关大值转交给 UI。
    for (const row of response.data.entries) {
      if (row?.key === keys[i] && typeof row.value === 'string') rows.push(row);
    }
  }
  return rows;
};
