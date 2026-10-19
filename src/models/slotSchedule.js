// The interval is the idle gap after each slot ends.
function build(now, durationUnits, intervalUnits, count) {
    if(!Number.isFinite(now) || !Number.isInteger(durationUnits) || durationUnits<1 || durationUnits>16 ||
        !Number.isInteger(intervalUnits) || intervalUnits<1 || intervalUnits>96 ||
        !Number.isInteger(count) || count<1 || count>20)
        throw new Error('Choose valid slot length, gap and count values.');
    const unit=15*60000;
    const stride=durationUnits+intervalUnits;
    const start=Math.ceil((now+30*60000)/unit)*unit;
    if(start+((count-1)*stride+durationUnits)*unit>now+7*86400000)
        throw new Error('Keep the slot schedule within the next 7 days.');
    return Array.from({length:count},(_,i)=>({
        begin:new Date(start+i*stride*unit).toISOString(),
        end:new Date(start+(i*stride+durationUnits)*unit).toISOString(),
    }));
}
if(typeof module!=='undefined')module.exports={build};
