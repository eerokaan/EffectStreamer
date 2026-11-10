const readline=require('node:readline');
const mode=process.argv[2];
if(mode==='die') process.exit(2);
if(mode==='malformed') {process.stdout.write('{bad}\n');setInterval(()=>{},1000);}
else if(mode==='oversized') {process.stdout.write('x'.repeat(1048577));setInterval(()=>{},1000);}
else if(mode==='hang') setInterval(()=>{},1000);
else {
    process.stderr.write('a diagnostic log, never JSON\n');
    process.stdout.write('{"version":1,"type":"event","event":"control-');
    setImmediate(()=>process.stdout.write('ready","payload":{}}\n'));
    readline.createInterface({input:process.stdin}).on('line',line=>{
        const r=JSON.parse(line);
        if(r.command==='crash') process.exit(3);
        if(r.command==='shutdown') {process.stdout.write(JSON.stringify({version:1,type:'event',event:'stopped',payload:{}})+'\n');process.exit(0);}
        setTimeout(()=>process.stdout.write(JSON.stringify({version:1,type:'response',id:r.id,ok:r.command!=='fail',...(r.command==='fail'?{error:{code:'rejected',message:'rejected'}}:{payload:r.payload})})+'\n'),r.command==='first'?20:0);
    });
}
