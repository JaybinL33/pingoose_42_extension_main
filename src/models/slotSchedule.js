// The interval is start-to-start; never schedule overlapping slots.
function build(now, durationUnits, intervalUnits, count) {
    if(!Number.isFinite(now) || !Number.isInteger(durationUnits) || durationUnits<1 || durationUnits>16 ||
        !Number.isInteger(intervalUnits) || intervalUnits<durationUnits || intervalUnits>96 ||
        !Number.isInteger(count) || count<1 || count>20)
        throw new Error('Choose an interval at least as long as the slot length.');
    const unit=15*60000;
    const start=Math.ceil((now+30*60000)/unit)*unit;
    if(start+((count-1)*intervalUnits+durationUnits)*unit>now+7*86400000)
        throw new Error('Keep the slot schedule within the next 7 days.');
    return Array.from({length:count},(_,i)=>({
        begin:new Date(start+i*intervalUnits*unit).toISOString(),
        end:new Date(start+(i*intervalUnits+durationUnits)*unit).toISOString(),
    }));
}
if(typeof module!=='undefined')module.exports={build};
