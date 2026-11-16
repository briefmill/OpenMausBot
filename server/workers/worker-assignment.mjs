const identity=value=>{
  if(typeof value!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value))throw Error('Invalid assignment identity');
  return value;
};
export function normalizeWorkerAssignment(value) {
  const botScope=value?.scope==='bot',keys=botScope?['bot','scope','project','resource']:['bot','thread','project','resource'];
  if(!value || Object.keys(value).some(key=>![...keys,'resources'].includes(key)) || keys.some(key=>!Object.hasOwn(value,key)) ||
     (value.resources!==undefined && (!Array.isArray(value.resources) || value.resources.length>15)))throw Error('Invalid assignment');
  return{bot:identity(value.bot),...(botScope?{scope:'bot'}:{thread:identity(value.thread)}),
    project:identity(value.project),resource:identity(value.resource),
    resources:[...new Set([value.resource,...(value.resources??[])].map(identity))].sort()};
}
export function workerAssignmentMatches(assignment,job) {
  return ['bot','project','resource'].every(key=>assignment[key]===job[key]) &&
    (assignment.scope==='bot' || assignment.thread===job.thread) && JSON.stringify(assignment.resources)===JSON.stringify(job.resources);
}
