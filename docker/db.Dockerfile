# 邻里流转 · 数据库镜像（PostgreSQL 16 + pgvector）
#
# 为什么不用现成的 `pgvector/pgvector:pg16`：
#   本机到 Docker Hub 的链路被 DNS 污染（`registry-1.docker.io` 解析到 157.240.11.40 后
#   i/o timeout），两个国内加速源在 25 分钟内 0 层完成。而 §6.5.9 的语义检索**必须**要
#   pgvector，所以改成「本地可构建」的路径。
#
# 三条试过的路，只有一条通（每条都实测过，注释里的结论就是实验记录）：
#   1) 源码编译 `make && make install`：卡在 `apk add build-base` 59 分钟无进展——
#      不是慢，是 build-base 的依赖图里某个包拉不动。这条路放弃了。
#   2) 装当前 Alpine 仓库（v3.24）的 `postgresql-pgvector`：它是给 **Alpine 自己的
#      PostgreSQL 18** 编译的，落到 `/usr/lib/postgresql18/`，而本镜像的 PG16 在
#      `/usr/local/`。版本与路径双重不匹配，`CREATE EXTENSION` 报 `not available`。死路。
#   3) ✅ 装 **v3.20 归档仓库**的 `postgresql-pgvector`：APKINDEX 实测其依赖是
#      `postgresql16`，产物为 `usr/lib/postgresql16/vector.so`。PG server 模块的 ABI
#      按大版本走，所以 0.6.2 的二进制在本镜像的 16.15 上能直接装载。
#
# 为什么这条路便宜：基镜像 `postgres:16-alpine` **已在本地**，构建不触发任何 registry
# 拉取；只需 Alpine CDN 可达（实测 `dl-cdn.alpinelinux.org` 秒级返回）。
#
# 数据卷兼容性：PG 大版本不变（16），数据目录格式一致，换用本镜像不影响既有 volume。
FROM postgres:16-alpine

# 固定到具体的 apk 版本与 sha256，而不是「取 latest」：
#   - 向量列宽、索引算子名跨版本可能变，静默升级会让已建索引失效；
#   - 这条链路依赖一个第三方 CDN 上的裸二进制，没有校验就等于把镜像内容交给运气。
#
# **必须按目标架构取包**（Apple Silicon 实测教训）：本文件曾只钉 x86_64 一支，
# 在 arm64 上构建照样「成功」——control 与 .so 都落进了目录，构建期自检查文件存在性是过的，
# 直到 `CREATE EXTENSION vector` 才炸：
#   could not load library ".../vector.so": unsupported relocation type 6   (SQLSTATE 58P01)
# 即 x86_64 的 .so 装不进 arm64 的 PG。CI 的 ubuntu-latest 是 amd64、本地多为 arm64，
# 少一支就会出现「一边能跑一边不能跑」。下面的 case 两支都钉，并在构建期比对 ELF 头兜底。
ARG TARGETARCH
ARG PGVECTOR_VERSION=0.6.2-r0
# sha256 来自 `sha256sum` 对应 arch 的 apk 实测值（Alpine v3.20 community/{arch}）。
ARG PGVECTOR_SHA_X86_64=9287f89c0a71ac3ad3e406431c329202ccdebe3bef1441b7dc0c2849ffa8e3fc
ARG PGVECTOR_SHA_AARCH64=a4fad6ae6ce362997c2c2b163abb1e585f0d4537231662afe3e46898ca8543fe

RUN set -eu; \
  # TARGETARCH 由 BuildKit 注入（amd64 / arm64）；不带 BuildKit 构建时退化成宿主 `uname -m`，
  # 对「在本机建、在本机跑」的场景同样正确。
  arch="${TARGETARCH:-$(uname -m)}"; \
  case "$arch" in \
    amd64|x86_64) alpine_arch=x86_64; sha="$PGVECTOR_SHA_X86_64";; \
    arm64|aarch64) alpine_arch=aarch64; sha="$PGVECTOR_SHA_AARCH64";; \
    *) echo "FATAL: 没有针对 $arch 的 pgvector apk（v3.20 只有 x86_64 / aarch64 / armv7）" >&2; exit 1;; \
  esac; \
  url="https://dl-cdn.alpinelinux.org/alpine/v3.20/community/${alpine_arch}/postgresql-pgvector-${PGVECTOR_VERSION}.apk"; \
  echo "[pgvector] $arch -> $alpine_arch"; \
  wget -q -O /tmp/pgvector.apk "$url"; \
  echo "$sha  /tmp/pgvector.apk" | sha256sum -c -; \
  mkdir -p /tmp/pgvector && cd /tmp/pgvector; \
  tar -xf /tmp/pgvector.apk; \
  # apk 内部就是 tar，解出来的路径按 Alpine 自己的布局排（postgresql16），
  # 而官方镜像的 PG 在 /usr/local。这里按 pg_config 的实际目录安放，而不是硬编码路径：
  # 硬编码会让基镜像一升级就悄悄装到错误的目录里去。
  cp usr/lib/postgresql16/vector.so "$(pg_config --pkglibdir)/"; \
  cp usr/share/postgresql16/extension/vector* "$(pg_config --sharedir)/extension/"; \
  rm -rf /tmp/pgvector /tmp/pgvector.apk

# 构建期自检：控制文件与 so 都必须落在 PG16 的实际目录里，否则这个镜像是哑的。
# 只查 control 不够——so 缺了照样 `CREATE EXTENSION` 失败，而那时已经轮到运行时才发现。
# 再加一条 ELF e_machine 比对：文件存在但架构错位（本次踩的就是这条）同样必须当场红。
# e_machine 是 ELF 头第 18-19 字节（小端）：3c=x86-64、b7=aarch64。busybox 的 od 不支持
# `-j`，所以用 dd 取偏移。
RUN set -eu; \
  test -f "$(pg_config --sharedir)/extension/vector.control"; \
  test -f "$(pg_config --pkglibdir)/vector.so"; \
  e_machine() { dd if="$1" bs=1 skip=18 count=2 2>/dev/null | od -An -tx1 | tr -d ' \n'; }; \
  pg_em="$(e_machine "$(which postgres)")"; \
  vec_em="$(e_machine "$(pg_config --pkglibdir)/vector.so")"; \
  if [ "$pg_em" != "$vec_em" ]; then \
    echo "FATAL: vector.so 与 PG 二进制架构不一致（PG e_machine=$pg_em / vector=$vec_em）" >&2; \
    exit 1; \
  fi; \
  echo "pgvector installed into $(pg_config --pkglibdir) (e_machine=$vec_em)"
