const axios = require("axios");
const cron = require("cron");
const vm2 = require("vm2");
const URL = require("url").URL;

process.env.TZ = "Asia/Shanghai";//设置时区
axios.defaults.timeout = 5000;//超时时间


const Status = {
    IDLE: "IDLE",
    RESERVED: "RESERVED",
    STUDYING: "STUDYING"
};




/*
    用户类
*/
const User = class {
    constructor(sessid) {
        this.sessid = sessid;
    }

    get header() {
        return {
            "Accept": "*/*",
            "User-Agent": "MicroMessenger/8.0.2",
            "Cookie": "wechatSESS_ID=" + this.sessid

        }
    }

    async httpGet(url) {
        let response = await axios.get(url, {
            headers: this.header
        });
        return response.data;
    }

    async httpPost(url, data) {
        let response = await axios.post(url, data, {
            headers: this.header
        });
        return response.data;
    }

    async name() {
        let html = await this.httpGet('https://wechat.v2.traceint.com/index.php/center.html');
        if (!html)
            return null;
        let regrex = /<div class="nick">(.*?)<\/div>/;
        return regrex.exec(html)?.pop() || null;
    }

    async status() {
        let html = await this.httpGet('https://wechat.v2.traceint.com/index.php/reserve/index.html');
        if (html.indexOf("到馆签到") != -1)
            return Status.RESERVED;
        else if (html.indexOf("已学习") != -1)
            return Status.STUDYING;
        else
            return Status.IDLE;
    }

    async countdown() {
        let html = await this.httpGet('https://wechat.v2.traceint.com/index.php/reserve/index.html');
        let regrex = /请在\s+([0-9]+):([0-9]+)\s+前到馆签到/;
        let m = regrex.exec(html);
        if (!m)
            return -1;
        let current = new Date();
        let deadline_hour = parseInt(m[1]);
        let deadline_min = parseInt(m[2]);

        // 返回剩余秒数
        return (deadline_hour - current.getHours()) * 3600 +
            (deadline_min - current.getMinutes()) * 60 -
            current.getSeconds();
    }

    async getSeats(roomid) {
        let html = await this.httpGet('http://wechat.v2.traceint.com/index.php/reserve/layoutApi/action=settings_seat_cls&libid=' + roomid + '.html');
        let seats = {};
        // 举例：此座位ID为“12,34”，座位号为“80”
        // <div class="grid_cell" data-key="12,34"><em>80</em></div>
        // 使用粗劣的正则表达式，大致匹配出它们的对应关系
        let divs = html.toString().matchAll(/<div[^>]+?grid_cell[^>]+?data-key="([^"]+)"[\s\S]+?<em>([0-9]+)<\/em>[\s\S]+?<\/div>/g);
        for (let div of divs)
            seats[div[2]] = div[1];
        // console.log(html)
        console.log(seats)
        return seats;
    }

    async cancel() {
        let data = await this.httpPost('https://wechat.v2.traceint.com/index.php/reserve/token.html', 'type=cancle');
        if (data['code'] != 0)
            return {
                success: false,
                msg: data['msg']
            };
        let token = data['msg'];
        await this.httpGet('http://wechat.v2.traceint.com/index.php/cancle/index?t=' + token);
        if (await this.status() == Status.IDLE)
            return {
                success: true,
                msg: null
            };
        else
            return {
                success: false,
                msg: null
            };
    }

    async reserve(roomid, seatno) {
        let seats = await this.getSeats(roomid);
        if (!seats)
            return {
                success: false,
                msg: "无此场馆",
                response: null
            };

        let seatid = seats[seatno]
        if (!seatid)
            return {
                success: false,
                msg: "无此座位",
                response: null
            };
        // 此处为服务器脚本提供一个隔离的沙箱环境
        // 为保证在异步操作中，返回值能够被成功接收，此处预先定义一个空的resolve函数
        let resolve = () => {
        };
        const vm_context = {
            AJAX_URL: "https://wechat.v2.traceint.com/index.php/reserve/get/",
            T: {
                ajax_get: async (url, callback) => {
                    let response = await this.httpGet(url)
                    resolve({
                        success: response['code'] == 0,
                        msg: response['msg'],
                        response: response
                    });
                }
            }
        };

        // 在指定房间的网页中，寻找reserve_seat所在的js文件
        let html = await this.httpGet("http://wechat.v2.traceint.com/index.php/reserve/layout/libid=" + roomid + ".html");
        let regexp = /https?:\/\/[!-~]+\/[0-9a-zA-Z]+\.js/g;
        let m = false, reserve_seat = null;
        while (m = regexp.exec(html)) {
            let jsUrl = m.toString()
            let jsContent = await this.httpGet(jsUrl);

            // js文件特征：内容含有“reserve_seat”、“T.ajax_get”
            if (jsContent.search("reserve_seat") != -1 && jsContent.search("T.ajax_get") != -1) {
                // 在虚拟机中执行js文件，并返回reserve_seat函数
                reserve_seat = this._reserve_seat_func(jsContent, vm_context);
            }
        }

        if (typeof reserve_seat != 'function')
            return {
                success: false,
                msg: "找不到预定函数，可能场馆暂未开放。",
                response: null
            };

        // 将真正的resolve函数赋值至作用域，执行reserve_seat
        return await new Promise(function (r, reject) {
            resolve = r;
            reserve_seat(roomid, seatid);
        });
    }

    _reserve_seat_func(script, vm_context) {
        const vm2_vm = new vm2.VM({
            timeout: 1000,
            sandbox: vm_context
        });
        vm2_vm.run(script);
        return vm2_vm.run(`global.reserve_seat`);
    }
};


/*
    用户门面
*/
const LibUser = class {
    constructor(sessid) {
        this.user = new User(sessid);
        this.autoCancelTimer = null;
    }

    async init() {
        let name = await this.user.name();
        if (!name) {
            throw "会话已过期,需要重新登录获取cookie";
        }
        console.log("欢迎 " + name);
    }

    async status() {
        let status_text;
        switch (await this.user.status()) {
            case Status.IDLE:
                status_text = '空闲';
                break;
            case Status.RESERVED:
                status_text = '已预定';
                break;
            case Status.STUDYING:
                status_text = '学习中';
                break;
        }
        console.log("您当前的状态是: " + status_text);
    }

    async reserve(roomid, seatno) {
        let ret = await this.user.reserve(roomid, seatno);
        if (ret['success']) {
            console.log("座位预定成功！");
        } else {
            console.log("座位预定失败，原因是: " + ret['msg']);
        }
    }

    async cancel() {
        let ret = await this.user.cancel();
        if (ret['success']) {
            console.log("退座成功！");
        } else {
            console.log("退座失败，请手动退座或重试！");
        }
    }

    async countdown() {
        let cd = await this.user.countdown();
        console.log("您需要在 " + ~~(cd / 60) + "分" + cd % 60 + "秒 内到场验证。");
    }

    // minSec: 小于此值触发自动退座（如已开启）
    // intervalSec: 剩余时间更新间隔
    async autoCancel(enable = true, minSec = 120, intervalSec = 30) {
        if (enable && !this.autoCancelTimer) {
            if (await this.user.status() != Status.RESERVED) {
                console.log("您不处于待验证状态，自动退座已取消。");
                return;
            }
            //下面的自动检测默认30s执行一次
            this.autoCancelTimer = setInterval(async () => {
                try {
                    let cd = await this.user.countdown();
                    if (cd > 0) {
                        console.log("您需要在 " + ~~(cd / 60) + "分" + cd % 60 + "秒 内到场验证。");
                    }

                    if (cd > 0 && cd <= minSec) {
                        console.log("已达到保护时间，正在自动退座...");
                        await this.cancel().catch(err => console.error(err.stack));

                    } else if (cd < 0 && await this.user.status() != Status.RESERVED) {
                        console.log("您已不再处于待验证状态，自动退座任务结束。");

                        clearInterval(this.autoCancelTimer);
                        this.autoCancelTimer = null;
                    }
                } catch (err) {
                    console.error(err.stack);
                }
            }, intervalSec * 1000);

        } else if (!enable && this.autoCancelTimer) {
            clearInterval(this.autoCancelTimer);
            this.autoCancelTimer = null;
        }
    }

    cronReserve(roomid, seatno, autoCancel = false) {
        let libuser = this;

        async function asyncCall() {
            const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
            let attemps = 3;//默认抢 3次，成功或者超出次数停止
            let success = false;
//注意这里可以改抢多个地方位置=============================================
            for (var i = 0; i < seatno.length; i++) {
                if (!success) {
                    console.log("准备抢：", roomid[i], "号阅览室", seatno[i], "号座")
                }
                while (!success && attemps > 0) {
                    attemps--;
                    let ret = await libuser.user.reserve(roomid[i], seatno[i]).catch(err => console.error(err.stack));
                    let reason = ret ? ret['msg'] : false;
                    success = ret ? ret['success'] : false;
                    if (success) {
                        console.log("座位预定成功！");
                    } else {
                        console.log("座位预定失败，原因是: " + reason);
                    }
                    await sleep(200);
                }
                attemps = 3
            }
//==========================================================
            if (autoCancel) {
                libuser.autoCancel();
            }
        }

        asyncCall()

    }
};

/*
    主函数
*/
async function main() {
    var sessid = sess_id;
    var roomid = room_id;
    var seatno = seat_no;
    var date = new Date();
    var nowDate = date.getDate();
    var nowMonth = date.getMonth();
    console.log(`将在 ${nowMonth + 1}月${nowDate}日${timearr[0]}:${timearr[1]}:${timearr[2]}预定 ${roomid} 号房间的 ${seatno} 号座位`);
    let user = new LibUser(sessid);
    await user.init();
    new cron.CronJob(//设置定时器
        `${timearr[2]} ${timearr[1]} ${timearr[0]} ${nowDate} ${nowMonth} * `,
        async function () {
            user.cronReserve(roomid, seatno, autoCancel = true);
        },
        null,
        true,
        process.env.TZ,
    )
}


/*
    http监听服务器,检测到用户提交后，就调用主函数
*/
const http = require('http');
var querystring = require('querystring');
const hostname = '127.0.0.1';
const port = 8081;
let sess_id;
let timearr;
let room_id;
let seat_no;
const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    if (req.url !== "/favicon.ico") {
        var str = '';
        req.on('data', (chunk) => {
            str += chunk
        })
        req.on('end', () => {
            var obj = querystring.parse(str);
            if (obj.passid == 'handsomeboy') {//你能发现吗？这是写死的验证码
                sess_id = obj.sessid;
                timearr = obj.time.split(":");
                room_id = obj.cgid;
                seat_no = obj.seatid;
                main()//执行主函数
                res.end('<h1 align="center">已经提交到后台，请静候佳音！</h1>')
            } else {
                res.end('<h1 align="center">输入表单有误，请重新提交</h1>')
            }
        })
    }
})
server.listen(port, hostname,)

