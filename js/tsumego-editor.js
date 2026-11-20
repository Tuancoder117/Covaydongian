/* Trình biên tập thế cờ Tsumego — dữ liệu tự tạo lưu trên thiết bị */
class TsumegoEditor {
    constructor() {
        this.panel = document.getElementById('tsumego-editor');
        this.canvas = document.getElementById('tsumego-editor-board');
        if (!this.panel || !this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.size = 9;
        this.stones = [];
        this.sequence = [];
        this.pendingMove = null;
        this.tool = 'setup';
        this.color = 1;
        this.editingId = null;
        this.custom = this.readCustom();
        this.bind();
        this.draw();
    }
    readCustom() {
        try {
            const data = JSON.parse(localStorage.getItem('cvdgl_custom_tsumego') || '[]');
            return Array.isArray(data) ? data : [];
        } catch (_) { return []; }
    }
    persist() {
        try {
            localStorage.setItem('cvdgl_custom_tsumego', JSON.stringify(this.custom));
            return true;
        } catch (_) {
            alert('Không thể lưu dữ liệu. Bộ nhớ trình duyệt có thể đã đầy hoặc bị chặn.');
            return false;
        }
    }
    bind() {
        this.canvas.addEventListener('click', e => this.onBoardClick(e));
        document.getElementById('editor-size').addEventListener('change', e => {
            this.size = Number(e.target.value); this.stones = []; this.sequence = []; this.pendingMove = null; this.draw();
        });
        document.querySelectorAll('[data-editor-tool]').forEach(b => b.addEventListener('click', () => {
            this.tool = b.dataset.editorTool;
            document.querySelectorAll('[data-editor-tool]').forEach(x => x.classList.toggle('active', x === b));
            this.updateStatus();
        }));
        document.querySelectorAll('[data-editor-color]').forEach(b => b.addEventListener('click', () => {
            this.color = Number(b.dataset.editorColor);
            document.querySelectorAll('[data-editor-color]').forEach(x => x.classList.toggle('active', x === b));
        }));
        document.getElementById('editor-add-step').addEventListener('click', () => this.addStep());
        document.getElementById('editor-skip-reply').addEventListener('click', () => this.addStep(true));
        document.getElementById('editor-undo').addEventListener('click', () => {
            if (this.tool === 'setup') this.stones.pop(); else { this.pendingMove = null; this.sequence.pop(); }
            this.draw(); this.updateStatus();
        });
        document.getElementById('editor-clear').addEventListener('click', () => {
            if (confirm('Xóa toàn bộ quân và các nước đã vẽ?')) { this.stones=[]; this.sequence=[]; this.pendingMove=null; this.draw(); this.updateStatus(); }
        });
        document.getElementById('editor-save').addEventListener('click', () => this.save());
        document.getElementById('editor-export').addEventListener('click', () => this.exportData());
        document.getElementById('editor-import').addEventListener('change', e => this.importData(e.target.files[0]));
        document.getElementById('editor-edit-select').addEventListener('change', e => this.loadForEdit(e.target.value));
    }
    toggle() {
        if (typeof initTsumegoIfNeeded === 'function') initTsumegoIfNeeded();
        this.panel.hidden = !this.panel.hidden;
        if (!this.panel.hidden) {
            this.custom = this.readCustom();
            this.refreshSelect();
            this.attachToApp();
            this.draw();
            this.panel.scrollIntoView({behavior:'smooth',block:'start'});
        }
    }
    coord(e) {
        const r=this.canvas.getBoundingClientRect(), px=(e.clientX-r.left)*this.canvas.width/r.width, py=(e.clientY-r.top)*this.canvas.height/r.height;
        const pad=30, step=(this.canvas.width-pad*2)/(this.size-1);
        const x=Math.round((px-pad)/step), y=Math.round((py-pad)/step);
        return x>=0&&y>=0&&x<this.size&&y<this.size?{x,y}:null;
    }
    onBoardClick(e) {
        const p=this.coord(e); if(!p)return;
        const key=(x,y)=>x+','+y;
        if(this.tool==='setup') {
            this.stones=this.stones.filter(s=>s.x!==p.x||s.y!==p.y);
            if(!document.getElementById('editor-erase').checked) this.stones.push({...p,color:this.color});
        } else if(this.tool==='player') {
            this.pendingMove=p;
        } else if(this.tool==='reply') {
            if(!this.pendingMove){alert('Hãy chọn nước người chơi trước.');return;}
            this.pendingReply=p;
        }
        this.draw(); this.updateStatus();
    }
    addStep(skip=false) {
        if(!this.pendingMove){alert('Chọn nước đi của người chơi trên bàn cờ trước.');return;}
        const reply=skip?null:(this.pendingReply||null);
        this.sequence.push({move:this.pendingMove.x+','+this.pendingMove.y,reply:reply?{...reply}:null,explanation:document.getElementById('editor-step-note').value.trim()||'Nước đi trong lời giải.'});
        this.pendingMove=null; this.pendingReply=null;
        document.getElementById('editor-step-note').value='';
        this.draw(); this.updateStatus();
    }
    draw() {
        const c=this.ctx,w=this.canvas.width,pad=30,cell=(w-pad*2)/(this.size-1);
        c.fillStyle='#e8b976';c.fillRect(0,0,w,w);c.strokeStyle='#604522';c.lineWidth=1;
        for(let i=0;i<this.size;i++){let a=pad+i*cell;c.beginPath();c.moveTo(pad,a);c.lineTo(w-pad,a);c.stroke();c.beginPath();c.moveTo(a,pad);c.lineTo(a,w-pad);c.stroke();}
        this.stones.forEach(s=>this.stone(pad+s.x*cell,pad+s.y*cell,cell*.43,s.color));
        const mark=(p,color,label)=>{if(!p)return;c.strokeStyle=color;c.lineWidth=3;c.beginPath();c.arc(pad+p.x*cell,pad+p.y*cell,cell*.28,0,Math.PI*2);c.stroke();if(label){c.fillStyle=color;c.font='bold 12px sans-serif';c.textAlign='center';c.fillText(label,pad+p.x*cell,pad+p.y*cell+4);}};
        this.sequence.forEach((s,i)=>{const [x,y]=s.move.split(',').map(Number);mark({x,y},'#16803d',String(i+1));});
        mark(this.pendingMove,'#1666c5','P');mark(this.pendingReply,'#b42318','M');
    }
    stone(x,y,r,color){const c=this.ctx;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color===1?'#171717':'#fff';c.fill();c.strokeStyle='#333';c.stroke();}
    updateStatus() {
        const labels={setup:'Đang vẽ thế cờ ban đầu',player:'Chọn nước đi của người chơi',reply:'Chọn nước đáp trả của máy'};
        document.getElementById('editor-status').textContent=labels[this.tool]+'. Số nước người chơi: '+this.sequence.length+(this.pendingMove?' · Đã chọn nước kế tiếp':'');
        document.getElementById('editor-sequence').textContent=this.sequence.map((s,i)=>'Bước '+(i+1)+': '+s.move+(s.reply?' → máy '+s.reply.x+','+s.reply.y:'')).join(' | ')||'Chưa có nước giải nào.';
    }
    save() {
        if(!this.stones.length){alert('Hãy đặt ít nhất một quân lên bàn cờ.');return;}
        const title=document.getElementById('editor-title').value.trim();
        if(!title){alert('Hãy nhập tên bài tập.');return;}
        const level=document.getElementById('editor-level').value;
        const labels={'30k-20k':'30k – 20k','19k-10k':'19k – 10k','9k-1d':'9k – 1d'};
        const problem={id:this.editingId||('custom-'+Date.now()),title,level,levelLabel:labels[level],size:this.size,turn:Number(document.getElementById('editor-turn').value),stones:this.stones.map(s=>({...s})),sequence:this.sequence.map(s=>({...s,reply:s.reply?{...s.reply}:null})),winMoves:this.sequence.map(s=>s.move),replies:{},explanations:{},hintText:document.getElementById('editor-hint').value||'Hãy tìm nước đi then chốt.',description:document.getElementById('editor-description').value||''};
        if(!problem.sequence.length){alert('Hãy tạo ít nhất một nước trong lời giải.');return;}
        if(this.editingId){const i=this.custom.findIndex(p=>p.id===this.editingId);if(i>=0)this.custom[i]=problem;else this.custom.push(problem);}else this.custom.push(problem);
        if(!this.persist())return;
        this.custom=this.readCustom();this.attachToApp();this.refreshSelect();alert('Đã lưu bài tập trên thiết bị này.');this.editingId=problem.id;
    }
    attachToApp() {
        if(typeof initTsumegoIfNeeded==='function')initTsumegoIfNeeded();
        if(typeof tsumegoApp==='undefined'||!tsumegoApp)return;
        const defaults=tsumegoApp.problems.filter(p=>!String(p.id).startsWith('custom-'));
        tsumegoApp.problems=[...defaults,...this.custom];
        tsumegoApp.currentLevelFilter='all';tsumegoApp.syncFilterButtons();tsumegoApp.renderProblemList();
    }
    refreshSelect() {
        const el=document.getElementById('editor-edit-select');el.innerHTML='<option value="">— Chọn bài tự tạo để sửa —</option>';
        this.custom.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.title;el.appendChild(o);});
    }
    loadForEdit(id) {
        const p=this.custom.find(x=>x.id===id);if(!p)return;
        this.editingId=p.id;this.size=p.size||9;this.stones=p.stones.map(s=>({...s}));this.sequence=(p.sequence||[]).map(s=>({...s,reply:s.reply?{...s.reply}:null}));this.pendingMove=null;this.pendingReply=null;
        document.getElementById('editor-size').value=String(this.size);document.getElementById('editor-title').value=p.title;document.getElementById('editor-level').value=p.level;document.getElementById('editor-turn').value=String(p.turn);document.getElementById('editor-hint').value=p.hintText||'';document.getElementById('editor-description').value=p.description||'';
        this.draw();this.updateStatus();
    }
    exportData() {
        const blob=new Blob([JSON.stringify(this.custom,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='co-vay-bai-tap-tu-tao.json';a.click();URL.revokeObjectURL(url);
    }
    importData(file) {
        if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result);if(!Array.isArray(data))throw new Error('Định dạng không đúng');this.custom=[...this.custom,...data.filter(p=>p&&p.id&&Array.isArray(p.stones)&&Array.isArray(p.sequence))];this.persist();this.refreshSelect();this.attachToApp();alert('Đã nhập '+data.length+' bài tập.');}catch(e){alert('Không đọc được tệp JSON: '+e.message);}};reader.readAsText(file);
    }
}
window.tsumegoEditor=new TsumegoEditor();
