
---

# QustLibFuck
青岛科技大学图书馆抢座<br>
仅适用于v2版本的“我去图书馆”<br>
前端打包为index静态页面，后端为js文件，需要node环境下运行

---
<br>
<br>
<br>
#2023年

***我已经从青科毕业了，而且现在学校的图书抢座系统已更新***<br>
***故不再适用，回想青科的4年，成长颇多***<br>
***人生漫漫，前进永无止步，与君共勉***

<br>
<br>

下为曾经写的拙劣文章
---

## 前言
暑假留校，天气炎热，宿舍只有一个小风扇，无奈只能去图书馆蹭空调，结果抢不到座位。于是开始研究并开发此小demo。预期目标是搞出一个完整的前后端并且能为多人使用，前端打算用Vue，后端用Node.js。
边学边写，尽力而为。

------------
![](https://s1.ax1x.com/2022/07/07/jdImuQ.jpg)

## 分析流程

**1.抓包抢座请求：**
```javascript
http://wechat.v2.traceint.com/index.php/reserve/get/libid=10287&mlnlmn=12,8&yzm="
```
是一个Get请求，携带3个参数。
- libid====对应馆号
- mlnlmn====每次请求都会改变的一个hex_code
- 12,8====每个座位号对应的编码
- yzm====验证码，多次异常请求时携带，平时为空。先不用管。

**2.得到场馆号和座位编码：**
选择不同场馆多次抓包得到场馆对应值：
```javascript
cgid=[10287,10288,10290,10291,10292,11324 ]
namelist=['弘毅自习室','外文期刊阅览室','工科图书阅览室','文理图书阅览室','科技期刊阅览室','明德自修室']
```
座位编码：
```html
<div class="grid_cell grid_7" data-key="6,7" style="left:280px;top:245px;">
<em>窗</em>
<div class="grid_cell  grid_1" data-key="7,13" style="left:490px;top:280px;">
<em>13</em>==可以看到13号座位对应7,13
```
从返回的html中得知 grid_1 这一类别对应的是座位号和编码，可以用正则表达式提取。

**3.hex_code**
每次请求都会改变，发现是调用了选择座位那个页面底部的一个js，到时候同样可以模拟调用来得到。
![](https://s1.ax1x.com/2022/07/07/jd5wp8.jpg)
分析完毕

------------


## 实现思路

1. 前台为web界面，用户需要填写场馆号、座位号、Cookie、抢座时间，然后发送任务将表单传到后端。
2. 前端界面通过Axios通讯，可以实时显示后台信息。
3. 后端node.js 监听一个端口，将前端传来的信息处理保存，并用cron定时任务调用主函数。
4. 主函数实现功能：向"我去图书馆"发送抢座的http请求
5. 额外功能：每日签到，退座保护，cookie保活，监听空座。


## 后端实现
后端参考(抄)Github上的GoLib.js项目。

**1.创建web服务器**
监听8081端口，接受并处理post过来的表单，后台写死了一个验证码，验证通过后会调用main()函数，返回内容。
```javascript
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
            if (obj.passid == 'handsomeboy') {
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
```
**2.主函数**
获取当前的日期，在加上前端传过来的抢座时间组成定时任务，定时执行抢座函数cronReserve()，需要传入场馆号、座位编码、是否退座保护。
```javascript
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
```
**3.抢座函数**
设置抢座次数attemps为3，遍历参数中的座位列表，如果当前是未成功的状态并且抢座次数大于0，就发送抢座请求并返回服务器响应状态。
```javascript
cronReserve(roomid, seatno, autoCancel = false) {
        let libuser = this;
        async function asyncCall() {
            const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
            let attemps = 3;//默认抢 3次，成功或者超出次数停止
            let success = false;
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
            if (autoCancel) {
                libuser.autoCancel();
            }
        }
        asyncCall()
    }
};
/*
	发送抢座请求：
*/
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

```
**4.正则表达式爬座位列表**
class="grid_cell  grid_1"的标签对应的是座位号，这一部分比较简单用python写的。
```python
def getseatlist(cgid):#获取座位对应的id,传入的cgid是场馆号
    url = 'http://wechat.v2.traceint.com/index.php/reserve/layoutApi/action=settings_seat_cls&libid=%s.html'%(cgid)
    response = requests.get(url=url,headers=mheaders,verify=False)
    response.encoding = 'utf8'
    id = re.compile(#正则表达
        r'grid_1" data-key="(.*?)" style=".*">\n<em>(.*)</em>')
    id = id.findall(response.text)#得到一个一一对应的list
    for i in list(id):
        seat[i[1]]=i[0]
    # print(seat,'\n')#最后生成字典并返回
    return seat
```
**顺便吧每日签到积分也搞了**
```python
def usertask():#每日签到积分任务
    url1 = 'http://wechat.v2.traceint.com/index.php/usertask/index.html'#获取任务界面的地址
    url2='http://wechat.v2.traceint.com/index.php/usertask/ajaxdone.html'#每日签到积分地址
    response = requests.get(url=url1, headers=mheaders, verify=False).text
    id = re.compile(#这一步是在正则表达式获取每日刷新的签到 ID
        r'<td class="td-d"><button .* id="(.*?)">')
    id = id.findall(response)[0]
    data = {'id': id}
    response = requests.post(url=url2, data=data, headers=mheaders, verify=False)
    print(response.text.encode('utf-8').decode('unicode_escape'))

```

------------


## 前端实现
。。。
算是不丑吧，把宝塔css偷过来了，勉强是能用了。

![](https://s1.ax1x.com/2022/07/14/jf1pYF.jpg)


------------

## 部署（宝塔面板）：

1.将整个项目目录拷贝到服务器，然后打开终端执行：
```python
npm install   #安装依赖
```

2.安装 PM2管理器，使node项目可以后台运行，出错后可以自动重启。
添加一个项目

![](https://s1.ax1x.com/2022/07/14/jf3k9g.png)

启动文件就选上传目录中的js文件，其余会自动识别，内存上限填100MB比较合适。

![](https://s1.ax1x.com/2022/07/14/jf31CF.png)

3.部署完毕：
打开web界面发送抢座任务，查看运行日志。

![](https://s1.ax1x.com/2022/07/14/jf3cDI.png)

抢到座了
![](https://s1.ax1x.com/2022/07/14/jf3ovj.jpg)

默认是开启退座保护的，我们不去签到，到时自动触发。

![](https://s1.ax1x.com/2022/07/14/jf3OaV.jpg)

------------


Talk is cheap，学习之路漫漫。少年继续加油吧！！！！！！





