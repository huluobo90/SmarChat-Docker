# SmarChat Docker

公司内部使用的 Docker 原生 WhatsApp AI CRM。版本 1.0.0-alpha.3。

## 启动

```sh
sh deploy/setup.sh
docker compose up -d --build
```

打开 http://localhost:6081 。初始化仅创建 Bison01 超管和 Bison02–Bison07 六名成员，客户、聊天、附件、分析均为空。初始密码见本机生成的 `.secrets/bootstrap_password` 和 `.secrets/team_Bison02` 等文件，首次登录需改密。

本仓库不包含演示导入脚本、演示客户、截图、运行数据、WhatsApp 登录态或部署密钥。数据库和文件保存在 Docker volumes；升级时保留原 `.secrets` 和 volumes。

## 功能

- 多 WhatsApp 接入，成员客户隔离，超管全局查看及独立分析。
- 独立对话规则、客户评分、需求提炼、周报月报。
- 语音播放与按需转文字，配置支持语音转写的接口后使用。
- 公司共享资料库、加密备份恢复、成员停用与级联删除。
- 号码自动识别国家、回收站、图片与文件预览。
- 灰白界面、圆角发送框、Enter 发送和 Shift+Enter 换行、接待模式状态提示。

AI 和 WhatsApp 接入需另行配置。语音转写需兼容 `/audio/transcriptions` 接口。当前为内部测试版，真实平台联调和长期稳定性验收仍需完成。默认仅监听本机；对外提供服务时配置 HTTPS 和 PUBLIC_ORIGIN。

## 验证

```sh
npm ci
npm run typecheck
sh deploy/setup.sh
SECRET_DIR="$PWD/.secrets" npm test
npm run build
```

## 旧版导入（按需）

```sh
docker compose -f compose.yaml -f deploy/import.compose.yaml --profile migration build importer
```

不自动导入任何旧数据。项目为私有内部代码，未授予开源许可证。
