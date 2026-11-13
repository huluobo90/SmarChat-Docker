# SmarChat Docker

面向个人与团队的自部署 WhatsApp AI CRM。任何用户都可以从本仓库拉取源码，在自己的电脑或服务器上通过 Docker 构建并运行。

当前版本：**1.0.0-alpha.3**（Alpha 测试版）。

## 主要功能

- 多个 WhatsApp 账号接入与团队协作。
- 客户收件箱、图片与文件预览、语音播放及按需语音转文字。
- AI 辅助生成回复、按资料库与对话规则自动接待、随时转人工。
- 客户评分、核心需求提炼、下一步建议、客户分析周报与月报。
- 成员独立配置对话规则，客户与分析数据按权限隔离。
- 团队共享资料库、全数据备份恢复、账号停用及成员独占数据清理。
- 号码自动识别国家、会话回收站、Enter 发送、Shift+Enter 换行。

## 环境准备

安装 Git、Docker 和 Docker Compose v2。macOS / Windows 可使用 Docker Desktop；Windows 建议在 WSL2 的 Linux 终端执行以下命令。初始化脚本还需要 sh 和 OpenSSL。

首次构建需要联网下载基础镜像和 npm 依赖。GitHub 提供源码，本说明采用在部署主机上构建镜像的方式。

## 获取源码与首次启动

公开仓库可直接通过 HTTPS 克隆，无需申请仓库权限：

```sh
git clone https://github.com/huluobo90/SmarChat-Docker.git
cd SmarChat-Docker
sh deploy/setup.sh
docker compose up -d --build
```

在部署电脑上打开 [http://localhost:6081](http://localhost:6081)。首次构建和数据库初始化需要一定时间，可查看服务状态：

```sh
docker compose ps -a
docker compose logs --tail=100 api worker migrate
```

每次独立部署使用自己的数据库、文件存储、WhatsApp 登录态和 AI 接口配置。仓库不包含演示客户、聊天记录、附件、分析记录或部署密钥。

## 初始账号与权限

当前版本采用固定的 7 个团队账号，不开放用户自行注册：

| 账号 | 角色 | 数据范围 |
| --- | --- | --- |
| Bison01 | 超级管理员 | 查看全部账号客户数据；分析结果按操作人独立保存；管理成员和账号分配 |
| Bison02–Bison07 | 成员 | 仅查看分配给自己的客户，进行自己的客户分析并设置个人对话规则 |

资料库由团队共享。删除成员须二次确认，并清空其独占数据，保留团队共享资料及其他成员数据。

初始化脚本当前默认密码为 `bison666`，首次登录要求修改。账号初始密码保存在部署主机的 `.secrets/bootstrap_password` 和 `.secrets/team_Bison02` 等文件中。

**首次启动前可修改这些账号密码文件，为各账号设置独立密码；文件需保留非空密码，至少 6 个字符。** 数据库初始化后，再编辑这些文件不会重置已有账号密码。面向网络提供服务前，应完成初始账号改密或停用暂不使用的成员。

## 首次使用

1. 登录并修改初始密码。
2. 配置自己的 AI 接口地址、模型及密钥。
3. 连接自己的 WhatsApp 账号，并分配负责成员。
4. 上传资料库文件，设置回复规则、语言、边界和接待模式。
5. 检查客户收发、AI 回复及分析效果后，再启用所需的自动接待。

语音转文字需要配置支持 `/audio/transcriptions` 的服务。AI 服务与 WhatsApp 接入由部署者自行配置。当前版本仍需真实平台联调及长期稳定性验证。

## 远程访问部署的应用

默认服务仅监听部署主机的 `127.0.0.1:6081`。远程拉取源码和远程访问应用是两个独立步骤。

在服务器上使用时，建议通过同机 HTTPS 反向代理将域名转发到 `127.0.0.1:6081`，并支持 WebSocket。在仓库根目录建立不提交到 Git 的 `.env` 文件：

```dotenv
PUBLIC_ORIGIN=https://chat.example.com
COOKIE_SECURE=true
BIND_ADDRESS=127.0.0.1
SMARCHAT_PORT=6081
```

将示例域名替换为实际域名，配置好域名、证书和反向代理后，执行 `docker compose up -d` 应用配置。若反向代理运行在其他容器或其他主机，应按实际网络设置监听地址及访问控制。

## 拉取更新

先通过应用备份功能备份数据，并妥善保管现有 `.secrets`。在原部署目录执行：

```sh
git pull --ff-only origin main
sh deploy/setup.sh
docker compose up -d --build
docker compose ps -a
```

初始化脚本会保留已有密钥文件。更新时保持原部署目录、Compose 项目名称、`.secrets` 和 Docker volumes，避免连接到新的空数据库。若有本地源码修改，先处理修改再拉取更新。

停止服务可使用 `docker compose down`。**不要在保留数据的升级中使用 `docker compose down -v`，它会删除数据卷。**

## 数据与备份

- 业务数据保存在 Docker volumes 中，包括数据库、附件、备份及服务运行数据。
- `.secrets` 保存数据库凭据和加密主密钥，应与备份一起妥善保管。
- Git 拉取只更新源码，不会提供或同步其他部署者的客户数据。
- 不要将 `.env`、`.secrets`、客户数据、备份文件或 WhatsApp 登录态提交到仓库。
- 旧版数据不会自动导入；按需使用 `deploy/import-legacy.ts` 及配套导入配置。

## 开发验证

本地开发建议使用 Node.js 24，与 Docker 构建环境保持一致：

```sh
npm ci
sh deploy/setup.sh
npm run typecheck
SECRET_DIR="$PWD/.secrets" npm test
npm run build
```

## 源码使用说明

本项目向所有用户提供源码下载与自行部署使用。当前尚未选定标准开源许可证；第三方依赖遵循各自的许可证。欢迎通过仓库 Issues 反馈问题，请勿在公开反馈中附带客户隐私、登录凭据或密钥。
