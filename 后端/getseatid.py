# -*- 这个py是为了生成场馆中每个座位对应id的json的 -*-
import re
import requests
import json

#================需要修改处================================================
cgidlist=[10287,10288,10290,10291,10292,11324 ]
cgnamelist=['弘毅自习室','外文期刊阅览室','工科图书阅览室','文理图书阅览室','科技期刊阅览室','明德自修室']
mcookies ='FROM_TYPE=weixin; Hm_lvt_7ecd21a13263a714793f376c18038a87=1656278975; wechatSESS_ID=2120fc1dab1d54d4b743100b0003f4a2009304e7c18f015f; Hm_lpvt_7ecd21a13263a714793f376c18038a87=1656821426; SERVERID=82967fec9605fac9a28c437e2a3ef1a4|1656821434|1656821388'
#改成你自己的学校对应的场馆id，然后程序会自动把座位对应的id号爬下来
#打印在控制台，自己复制下来粘贴成json就好了
#========================================================================


mheaders = {
    'User-Agent': 'Mozilla/5.0 (iPad; CPU OS 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'Accept': '"*/*"',
    'cookie': mcookies}
seat={}
jsonlist={}

def getseatlist(cgid):#获取座位对应的id,传入的cgid是场馆号
    url = 'http://wechat.v2.traceint.com/index.php/reserve/layoutApi/action=settings_seat_cls&libid=%s.html'%(cgid)
    response = requests.get(url=url,headers=mheaders,verify=False)
    response.encoding = 'utf8'
    # print(response.text)
    id = re.compile(  # 这一步是在正则表达式获取每日刷新的签到 ID
        r'grid_1" data-key="(.*?)" style=".*">\n<em>(.*)</em>')
    id = id.findall(response.text)#得到一个一一对应的list
    for i in list(id):
        seat[i[1]]=i[0]
    # print(seat,'\n')#最后生成字典并返回
    return seat


#主函数，循环调用，最后打印出json
for i in list(cgidlist):
    jsonlist[str(i)]=getseatlist(i)
print(json.dumps(jsonlist))