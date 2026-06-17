import { compactOperationLogs } from '../server/store.mjs';

const result = await compactOperationLogs();

console.log(`操作日志压缩完成：${result.before} -> ${result.after}，移除旧重复记录 ${result.removed} 条。`);
console.log('说明：只压缩 operation-logs.json 的重复审计记录，不回退 usage-counters.json 中已累计的调用次数、有效人数或评分依据。');
