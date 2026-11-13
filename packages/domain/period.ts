export function reportPeriod(kind:string,anchor:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(anchor))throw Error('日期格式不正确')
 const local=new Date(anchor+'T00:00:00Z');if(!Number.isFinite(local.getTime())||local.toISOString().slice(0,10)!==anchor)throw Error('日期无效')
 if(kind==='month')local.setUTCDate(1);else local.setUTCDate(local.getUTCDate()-(local.getUTCDay()+6)%7)
 const end=new Date(local);if(kind==='month')end.setUTCMonth(end.getUTCMonth()+1);else end.setUTCDate(end.getUTCDate()+7)
 return {start:new Date(local.getTime()-8*3600000).toISOString(),end:new Date(end.getTime()-8*3600000).toISOString(),startDate:local.toISOString().slice(0,10),endDate:new Date(end.getTime()-86400000).toISOString().slice(0,10),days:(end.getTime()-local.getTime())/86400000}
}
