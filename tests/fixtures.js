const NOW = Date.parse('2026-09-29T14:00:00Z');
const EXP = '2027-09-29T14:00:00Z';
const contract = (type, overrides={}) => ({strike:100, expiration:EXP, type, iv:.2, oi:100, gamma:.02, delta:type==='call'?.5:-.5,...overrides});
const upstreamContract = (type, overrides={}) => { const c=contract(type,overrides); return [c.expiration,c.strike,c.type,c.iv,c.delta,c.gamma,null,null,null,null,overrides.mid ?? 3,c.oi,10,100]; };
const chain = () => ({chain:[{expiration:EXP,strikes:[[100,upstreamContract('call'),upstreamContract('put',{gamma:null,delta:null,iv:null,oi:300})]]}]});
// Equal OI/IV/T: gamma equality means d1(call) = -d1(put).
// Hence S* = sqrt(Kc Kp) exp(-(r + sigma²/2) T).
const analytic = () => ({contracts:[contract('call',{strike:95}),contract('put',{strike:110})], root:Math.sqrt(95*110)*Math.exp(-(.043+.2*.2/2))});
module.exports={NOW,EXP,contract,chain,analytic};
