## 下游数据库迁移

此目录维护下游功能的数据库迁移，使用独立的 `drizzle.__lobehub_fork_migrations` 记录表。启动时先执行上游迁移，再执行下游迁移。

下游表统一建在 `hardy` schema，表名和索引名都不占用 `public` 的命名空间，因此不会与上游新增对象重名。

下游 schema 通过 `drizzle.fork.config.ts` 指定。新增下游表时，将 schema 文件加入该配置，并确保上游 `drizzle.config.ts` 不会扫描到它。修改后执行 `bun run db:generate:fork`，检查生成的 SQL、外键和快照，再按数据库迁移规范处理可重复执行和升级兼容性。

上游 schema 使用 `bun run db:generate`。同步上游后，应确认上游生成命令不会包含下游表，且下游生成命令没有意外包含上游表。两条迁移链的编号和执行记录相互独立，但下游迁移仍可依赖上游表，因而不能调换执行顺序。
