<template>
<section v-show="app.isSkillInventoryViewActive" class="view-grid skill-inventory-view skill-inventory-original-view">
  <div class="panel-card page-card skill-inventory-panel">
    <div class="skill-inventory-panel-header">
      <div class="skill-inventory-toolbar">
      <div>
        <h3>{{ app.skillInventoryTab === 'assets' ? 'AI 产物清单' : '产物列表' }}</h3>
      </div>
      <div class="panel-actions art-progress-actions skill-inventory-top-actions">
        <ElTooltip v-if="app.canRefreshSkillInventoryScan" :content="app.skillInventoryRefreshHint" placement="top" effect="dark">
          <ElButton :loading="app.loading.scan" @click="app.scanAllProjects">刷新库存</ElButton>
        </ElTooltip>
        <ElButton v-if="app.canManageSkillSourceDisplay" plain @click="app.openSkillSourceDisplayDialog">展示管理</ElButton>
        <ElButton v-if="(app.skillInventoryTab === 'list' || app.skillInventoryTab === 'assets') && app.canConnectSkillInventorySource" type="primary" @click="app.openAssetScanConnect">接入扫描</ElButton>
      </div>
      </div>
      <div class="skill-inventory-search-row">
        <ElInput
          v-if="app.skillInventoryTab === 'list' || app.skillInventoryTab === 'assets'"
          v-model="app.skillInventoryKeyword"
          clearable
          class="skill-inventory-search"
          placeholder="搜索产物"
        />
      </div>
    </div>

    <div v-show="app.skillInventoryTab === 'list' || app.skillInventoryTab === 'assets'" class="skill-member-summary">
      <div class="skill-member-grid skill-product-stats-grid">
        <article
          v-for="stat in app.safeSkillInventoryProductStats"
          :key="stat.key"
          :class="['skill-member-card skill-product-stat-card', { active: app.isSkillInventoryProductStatActive(stat.key) }]"
          role="button"
          tabindex="0"
          @click="app.selectSkillInventoryKindFilter(stat.key)"
          @keydown.enter.prevent="app.selectSkillInventoryKindFilter(stat.key)"
          @keydown.space.prevent="app.selectSkillInventoryKindFilter(stat.key)"
        >
          <div class="skill-member-card-top">
            <strong>{{ stat.label }}</strong>
            <b>{{ stat.value }}</b>
          </div>
        </article>
      </div>
    </div>

    <ElDialog
      v-if="app.skillSourceDisplayDialog.visible"
      v-model="app.skillSourceDisplayDialog.visible"
      title="来源内容展示管理"
      width="1080px"
      top="8vh"
      class="app-dialog skill-source-display-dialog"
      append-to-body
      :close-on-click-modal="false"
    >
      <div class="skill-source-display-panel">
        <div class="skill-source-display-toolbar">
          <ElInput
            v-model="app.skillSourceDisplayDialog.keyword"
            clearable
            placeholder="搜索产物、来源或路径"
          />
          <ElCheckbox
            :model-value="app.skillSourceDisplayAllVisible"
            :indeterminate="app.skillSourceDisplayPartlyVisible"
            :disabled="app.loading.skillVersion || !app.skillSourceDisplayRows.length"
            @change="checked => app.toggleAllSkillSourceDisplay(checked)"
          >
            全选展示
          </ElCheckbox>
          <ElButton
            v-if="app.canRefreshSkillInventoryScan"
            type="primary"
            plain
            :loading="app.loading.folderScan"
            @click="app.scanFolderSkillSources"
          >
            扫描文件夹
          </ElButton>
          <span>扫描文件夹只刷新本地目录和共享盘；顶部刷新库存只同步 Git。取消展示不会删除源文件。</span>
        </div>
        <ElTable
          class="skill-clean-table skill-source-display-table"
          :data="app.skillSourceDisplayRows"
          row-key="uid"
          max-height="560"
          empty-text="暂无本地路径或共享盘扫描产物，请点击扫描文件夹或先接入文件夹来源"
        >
          <ElTableColumn label="展示" width="86" align="center">
            <template #default="{ row }">
              <ElCheckbox
                :model-value="row.displayHidden !== true"
                :disabled="app.loading.skillVersion"
                @change="checked => app.toggleSkillSourceDisplay(row, checked)"
              />
            </template>
          </ElTableColumn>
          <ElTableColumn label="文件夹名称" min-width="200">
            <template #default="{ row }">
              <div class="skill-title-cell">
                <strong>{{ app.skillSourceDisplayOriginalName(row) }}</strong>
                <span>{{ row.relativePath || row.path || '-' }}</span>
              </div>
            </template>
          </ElTableColumn>
          <ElTableColumn label="产物名称" min-width="210">
            <template #default="{ row }">
              <ElInput
                :model-value="app.skillSourceDisplayNameDraft(row)"
                clearable
                placeholder="默认使用文件夹名称"
                :disabled="app.loading.skillVersion || !app.canManageSkillSourceDisplay"
                @input="value => app.updateSkillSourceDisplayNameDraft(row, value)"
                @change="value => app.saveSkillSourceDisplayName(row, value)"
                @keyup.enter="event => app.saveSkillSourceDisplayName(row, event.target.value)"
              />
            </template>
          </ElTableColumn>
          <ElTableColumn label="调用别名" min-width="240">
            <template #default="{ row }">
              <ElInput
                :model-value="app.skillSourceDisplayAliasDraft(row)"
                clearable
                placeholder="多个别名用顿号或逗号隔开"
                :disabled="app.loading.skillVersion || !app.can('skill.alias.manage')"
                @input="value => app.updateSkillSourceDisplayAliasDraft(row, value)"
                @change="value => app.saveSkillSourceDisplayAliases(row, value)"
                @keyup.enter="event => app.saveSkillSourceDisplayAliases(row, event.target.value)"
              />
            </template>
          </ElTableColumn>
          <ElTableColumn label="来源" width="180">
            <template #default="{ row }">
              <span class="skill-table-text">{{ row.projectName || row.source || '-' }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="贡献人" width="220">
            <template #default="{ row }">
              <ElSelect
                class="skill-source-owner-select"
                :model-value="app.personList(row.uploader)"
                multiple
                collapse-tags
                collapse-tags-tooltip
                filterable
                clearable
                placeholder="选择贡献人"
                :disabled="app.loading.skillVersion || !app.canEditSkillInventoryOwnerRow(row)"
                @change="value => app.saveSkillSourceDisplayOwner(row, value)"
              >
                <ElOption v-for="member in app.skillOwnerCandidateMembers" :key="member.name" :label="member.name" :value="member.name" />
              </ElSelect>
            </template>
          </ElTableColumn>
          <ElTableColumn label="类型" width="110">
            <template #default="{ row }">
              <ElSelect
                class="skill-source-type-select"
                :model-value="app.skillSourceDisplayTypeValue(row)"
                :disabled="app.loading.skillVersion || !app.canManageSkillSourceDisplay"
                @change="value => app.saveSkillSourceDisplayType(row, value)"
              >
                <ElOption label="Skill" value="skill" />
                <ElOption label="规范" value="document" />
                <ElOption label="文件夹产物" value="directory" />
              </ElSelect>
            </template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="110">
            <template #default="{ row }">
              <ElTag :type="row.displayHidden === true ? 'info' : 'success'" size="small">{{ row.displayHidden === true ? '不展示' : '展示中' }}</ElTag>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
      <template #footer>
        <div class="dialog-footer-actions">
          <ElButton @click="app.skillSourceDisplayDialog.visible = false">关闭</ElButton>
        </div>
      </template>
    </ElDialog>

    <ElDialog
      v-if="app.aiAssetDialog.visible"
      v-model="app.aiAssetDialog.visible"
      :title="app.aiAssetDialog.mode === 'manualSkill' ? '手动创建技能' : app.aiAssetDialog.readonly ? '人工研究记录明细' : '人工研究记录'"
      width="940px"
      top="8vh"
      class="app-dialog skill-validation-dialog"
      append-to-body
      :close-on-click-modal="false"
    >
      <ElForm v-if="app.aiAssetDialog.mode === 'manualSkill'" :model="app.aiAssetDialog.form" label-position="top" class="skill-validation-form manual-skill-form">
        <ElFormItem label="粘贴 SKILL.md">
          <ElInput v-model="app.aiAssetDialog.form.dailyNote" type="textarea" :rows="8" placeholder="粘贴完整 SKILL.md 内容，后续可用于沉淀技能说明、触发场景和验证信息。" />
        </ElFormItem>
        <div class="skill-validation-form-grid two">
          <ElFormItem label="技能名称">
            <ElInput v-model="app.aiAssetDialog.form.title" placeholder="填写具体技能文件名或技能名称" />
          </ElFormItem>
          <ElFormItem label="版本">
            <ElSelect v-model="app.aiAssetDialog.form.verifyStatus" placeholder="选择版本">
              <ElOption label="1.0" value="1.0" />
              <ElOption label="1.1" value="1.1" />
              <ElOption label="2.0" value="2.0" />
            </ElSelect>
          </ElFormItem>
        </div>
        <div class="skill-validation-form-grid two">
          <ElFormItem label="来源">
            <ElSelect v-model="app.aiAssetDialog.form.suites" placeholder="选择来源">
              <ElOption label="手动" value="手动" />
              <ElOption label="Google 表" value="Google 表" />
              <ElOption label="共享盘" value="共享盘" />
              <ElOption label="本地路径" value="本地路径" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem label="贡献人">
            <ElSelect v-model="app.aiAssetDialog.form.owner" filterable allow-create default-first-option multiple placeholder="选择或输入贡献人">
              <ElOption v-for="member in app.skillOwnerCandidateMembers" :key="member.name" :label="member.name" :value="member.name" />
            </ElSelect>
          </ElFormItem>
        </div>
        <ElFormItem label="适用场景">
          <ElInput v-model="app.aiAssetDialog.form.availablePeople" placeholder="例如：Figma 界面生成、规范套用、图层清洗、验收走查" />
        </ElFormItem>
        <ElFormItem label="技能描述">
          <ElInput v-model="app.aiAssetDialog.form.description" type="textarea" :rows="3" placeholder="说明这个技能解决什么问题、适合什么任务、产出什么结果。" />
        </ElFormItem>
        <ElFormItem label="仓库路径">
          <ElInput v-model="app.aiAssetDialog.form.finalPath" placeholder="/Users/se7en/ArtProject/platform/data/art-git/skills/xxx/SKILL.md" />
        </ElFormItem>
      </ElForm>
      <ElForm v-else :model="app.aiAssetDialog.form" label-position="top" class="skill-validation-form">
        <div class="skill-validation-form-grid three">
          <ElFormItem label="产物名称">
            <ElInput v-model="app.aiAssetDialog.form.title" :disabled="app.aiAssetDialog.readonly" />
          </ElFormItem>
          <ElFormItem label="套系">
            <ElInput v-model="app.aiAssetDialog.form.suites" :disabled="app.aiAssetDialog.readonly" />
          </ElFormItem>
          <ElFormItem label="贡献人">
            <ElInput v-model="app.aiAssetDialog.form.owner" :disabled="app.aiAssetDialog.readonly || !app.canManageSkillAssetOwner" placeholder="多人用、或逗号隔开" />
          </ElFormItem>
        </div>
        <div class="skill-validation-form-grid three">
          <ElFormItem label="进度状态">
            <ElInput v-model="app.aiAssetDialog.form.progressStatus" :disabled="app.aiAssetDialog.readonly" />
          </ElFormItem>
          <ElFormItem label="是否公开">
            <ElInput v-model="app.aiAssetDialog.form.publicStatus" :disabled="app.aiAssetDialog.readonly" />
          </ElFormItem>
          <ElFormItem label="可用人员">
            <ElInput v-model="app.aiAssetDialog.form.availablePeople" :disabled="app.aiAssetDialog.readonly" />
          </ElFormItem>
        </div>
        <div class="skill-validation-form-grid two">
          <ElFormItem label="产物目录 / 路径">
            <ElInput v-model="app.aiAssetDialog.form.finalPath" :disabled="app.aiAssetDialog.readonly" />
          </ElFormItem>
          <ElFormItem label="项目名 / 文件名">
            <ElInput v-model="app.aiAssetDialog.form.projectName" :disabled="app.aiAssetDialog.readonly" />
          </ElFormItem>
        </div>
        <div class="skill-validation-form-grid two">
          <ElFormItem label="验证信息">
            <ElInput v-model="app.aiAssetDialog.form.verifyStatus" :disabled="app.aiAssetDialog.readonly" />
          </ElFormItem>
          <ElFormItem label="Skill 路径">
            <ElInput v-model="app.aiAssetDialog.form.skillPath" :disabled="app.aiAssetDialog.readonly" />
          </ElFormItem>
        </div>
        <ElFormItem label="每日进展 / 说明">
          <ElInput v-model="app.aiAssetDialog.form.dailyNote" type="textarea" :rows="3" :disabled="app.aiAssetDialog.readonly" />
        </ElFormItem>
        <ElFormItem label="文件链接">
          <ElInput v-model="app.aiAssetDialog.form.fileLink" :disabled="app.aiAssetDialog.readonly" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <div class="dialog-footer-actions">
          <ElButton @click="app.closeAiAssetDialog">取消</ElButton>
          <ElButton v-if="app.canCreateSkillInventoryAsset && !app.aiAssetDialog.readonly" type="primary" :loading="app.loading.aiAssetSheet" @click="app.saveAiAsset">{{ app.aiAssetDialog.mode === 'manualSkill' ? '保存技能' : '保存' }}</ElButton>
        </div>
      </template>
    </ElDialog>

    <div v-show="app.skillInventoryTab === 'list' || app.skillInventoryTab === 'assets'" class="skill-list-section">
    <div v-if="!app.skillInventoryDisplayHasRows" class="skill-inventory-empty-state">
      <strong>{{ app.skillInventoryRecoveringRows ? '正在恢复库存明细' : '暂无扫描源产物' }}</strong>
      <span>{{ app.skillInventoryRecoveringRows ? '已检测到上次库存统计，正在重新读取明细列表；如果长期没有恢复，请点击刷新库存重建 Git 缓存，或在展示管理中扫描文件夹。' : '页面默认展示上次库存缓存；Git 内容点击刷新库存，本地目录和共享盘内容请在展示管理中扫描文件夹。' }}</span>
      <div>
        <ElButton v-if="app.canRefreshSkillInventoryScan" :loading="app.loading.scan || app.loading.skillInventoryCache" @click="app.scanAllProjects">刷新库存</ElButton>
        <ElButton v-if="app.canConnectSkillInventorySource" type="primary" @click="app.openAssetScanConnect">接入扫描</ElButton>
      </div>
    </div>
    <ElTable
      v-else
      class="skill-clean-table skill-product-table"
      :data="app.safeDisplayPagedSkillInventoryRows"
      :row-key="app.skillInventoryTableRowKey"
      table-layout="fixed"
      :scrollbar-always-on="true"
      empty-text="暂无产物列表"
    >
      <ElTableColumn label="产物名称" min-width="300" class-name="skill-product-name-column">
        <template #default="{ row }">
          <div class="skill-product-name-stack">
            <button type="button" class="skill-title-cell skill-title-button" :disabled="!app.skillInventoryContentReady" @click="app.openSkillInventoryDetail(row)">
              <strong>
                {{ row.productDisplayName || row.productFileName || row.title || row.id }}
              </strong>
              <span v-if="!row.displayIsPathScanFolderProduct">{{ row.displaySceneText }}</span>
            </button>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="版本" width="82">
        <template #default="{ row }">
          <span :class="['skill-version-pill', { 'is-editable': app.canEditSkillInventoryVersion && app.skillInventoryContentReady && !row.displaySnapshotOnly }, row.displayVersionClass]">
            {{ row.displayVersionLabel }}
            <select
              v-if="app.canEditSkillInventoryVersion && app.skillInventoryContentReady && !row.displaySnapshotOnly"
              class="skill-version-native-select"
              :value="row.displayVersionLabel"
              aria-label="选择展示版本"
              @change="app.saveSkillInventoryRowVersion(row, $event.target.value)"
            >
              <option v-for="version in app.skillVersionOptions" :key="version" :value="version">{{ version }}</option>
            </select>
          </span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="贡献人" width="96">
        <template #default="{ row }">
          <span class="skill-table-text">{{ row.displayOwnerText }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="调用次数" width="88">
        <template #default="{ row }">
          <span class="skill-table-number">{{ row.displayUsageCount }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="有效占比" width="88">
        <template #default="{ row }">
          <span class="skill-table-number">{{ row.displayUsageRate }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="质量分" width="88">
        <template #default="{ row }">
          <ElTooltip v-if="row.displayIsSkillProduct && row.displayQualityScore !== null" :content="row.displayQualityText" placement="top" effect="dark">
            <span :class="['skill-quality-pill', row.displayQualityClass]">{{ row.displayQualityScore }}</span>
          </ElTooltip>
          <span v-else class="skill-table-muted">-</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="132" fixed="right" align="center" class-name="skill-actions-column">
        <template #default="{ row }">
          <div class="table-action-row skill-action-links">
            <ElButton size="small" type="primary" plain :disabled="!app.skillInventoryContentReady || row.displaySnapshotOnly" @click.stop="app.openSkillUsageDetail(row)">明细</ElButton>
            <ElButton
              v-if="app.canOperateSkillInventoryManage && row.hidden !== true"
              size="small"
              type="danger"
              plain
              :disabled="!app.skillInventoryContentReady || row.displaySnapshotOnly"
              @click.stop="app.deleteSkillInventoryRow(row)"
            >
              作废
            </ElButton>
            <ElButton
              v-if="app.canOperateSkillInventoryManage && row.hidden === true"
              size="small"
              type="primary"
              plain
              :disabled="!app.skillInventoryContentReady || row.displaySnapshotOnly"
              @click.stop="app.restoreSkillInventoryRow(row)"
            >
              恢复
            </ElButton>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>
    <div class="pagination-bar">
      <span>共 {{ app.skillInventoryDisplayTotal }} 条</span>
      <ElPagination
        :current-page="app.skillInventoryPage" @update:current-page="value => app.skillInventoryPage = value"
        :page-size="app.skillInventoryPageSize" @update:page-size="value => app.setWorkbenchPageSize(value, 'skillInventoryPage')"
        :page-sizes="[10, 50, 100]"
        :total="app.skillInventoryDisplayTotal"
        page-size-label="条/页"
        layout="sizes, prev, pager, next"
      />
    </div>
    <section v-if="app.safeSkillInventoryDocumentRows.length" class="skill-document-section">
      <div class="skill-member-summary-head">
        <div>
          <strong>文件说明 / 指引</strong>
          <span>未归入技能的项目文档、规范说明和参考资料。</span>
        </div>
      </div>
      <ElTable
        class="skill-clean-table"
        :data="app.safeSkillInventoryDocumentRows"
        row-key="uid"
      >
        <ElTableColumn label="文件" min-width="320">
          <template #default="{ row }">
            <div class="skill-title-cell">
              <strong>{{ row.title || row.id }}</strong>
              <span>{{ row.id }}</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="贡献人" width="130">
          <template #default="{ row }">
            <span class="skill-table-text">{{ app.canonicalArtDeptPerson(row.uploader) || '-' }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="分类" width="150">
          <template #default="{ row }">
            <span class="skill-table-text">{{ row.category || '项目内容' }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="说明" min-width="360">
          <template #default="{ row }">
            <span class="skill-scene-text">{{ app.skillSceneText(row, '文件说明与指引') }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="位置 / 提交" min-width="280">
          <template #default="{ row }">
            <div class="skill-path-cell">
              <span>{{ row.relativePath || row.path || '-' }}</span>
              <small v-if="row.uploadedAt">{{ app.formatDateTime(row.uploadedAt) }}</small>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <div class="table-action-row">
              <ElButton
                type="primary"
                plain
                size="small"
                :disabled="!app.canViewSkillPreview"
                @click="app.openSkillPreview(row.skill)"
              >
                查看内容
              </ElButton>
            </div>
          </template>
        </ElTableColumn>
      </ElTable>
    </section>
    </div>

    <ElDrawer
      v-if="app.skillUsageDialog.visible"
      v-model="app.skillUsageDialog.visible"
      title="使用明细"
      direction="rtl"
      size="50%"
      class="app-dialog art-progress-log-drawer skill-usage-drawer"
      append-to-body
      :with-header="true"
    >
      <div class="skill-usage-panel">
        <div class="skill-usage-head">
          <div class="skill-usage-title-row">
            <div>
              <span>当前产物</span>
              <strong>{{ app.skillUsageDialog.row?.productDisplayName || app.skillUsageDialog.row?.productFileName || app.skillUsageDialog.row?.title || 'AI 产物' }}</strong>
            </div>
          </div>
          <div class="skill-usage-member-stats">
            <div class="skill-usage-member-stats-head">
              <strong>成员调用统计</strong>
            </div>
            <div v-if="app.skillUsageDialog.memberStats?.length" class="skill-usage-member-list">
              <article v-for="member in app.skillUsageDialog.memberStats" :key="member.name" class="skill-usage-member-item">
                <div>
                  <strong>{{ member.name }}</strong>
                </div>
                <div>
                  <b>{{ member.count }}</b>
                  <small>调用次数</small>
                </div>
              </article>
            </div>
            <div v-else class="art-progress-log-empty compact">暂无成员调用记录</div>
          </div>
          <div class="skill-usage-history-block">
            <div class="skill-usage-member-stats-head">
              <strong>更新与版本迭代</strong>
              <span>{{ app.skillUsageDialog.versionEntries?.length || 0 }} 条记录</span>
            </div>
            <div v-if="app.skillUsageDialog.versionEntries?.length" class="skill-usage-version-list">
              <article v-for="entry in app.skillUsageDialog.versionEntries" :key="entry.fullCommit || entry.commit || `${entry.time}-${entry.title}`" class="skill-usage-version-item">
                <div>
                  <strong>{{ entry.title }}</strong>
                  <span>{{ entry.author || '-' }} · {{ app.formatDateTime(entry.time) || '-' }}</span>
                </div>
                <small>{{ entry.commit || '未记录提交号' }}</small>
              </article>
            </div>
            <div v-else class="art-progress-log-empty compact">暂无版本迭代记录</div>
          </div>
        </div>
      </div>
    </ElDrawer>

    <ElDialog v-if="app.skillOwnerDialog.visible" v-model="app.skillOwnerDialog.visible" title="调整产物贡献人" width="420px" class="app-dialog" append-to-body align-center>
      <ElForm label-position="top" @submit.prevent>
        <ElFormItem label="产物">
          <ElInput :model-value="app.skillOwnerDialog.row?.productDisplayName || app.skillOwnerDialog.row?.title || '-'" disabled />
        </ElFormItem>
        <ElFormItem label="贡献人">
          <ElSelect v-model="app.skillOwnerDialog.owner" filterable allow-create default-first-option multiple placeholder="选择或输入成员">
            <ElOption v-for="member in app.skillOwnerCandidateMembers" :key="member.name" :label="member.name" :value="member.name" />
          </ElSelect>
          <small class="form-help-text">多人协作可选择多个成员，也可以直接输入后保存。</small>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <div class="dialog-footer-actions">
          <ElButton plain @click="app.skillOwnerDialog = { visible: false, row: null, owner: [] }">取消</ElButton>
          <ElButton type="primary" :loading="app.loading.skillVersion" @click="app.saveSkillOwnerOverride">保存</ElButton>
        </div>
      </template>
    </ElDialog>

    <ElDialog v-if="app.skillHistoryDialog.visible" v-model="app.skillHistoryDialog.visible" title="历史版本" width="760px" class="app-dialog skill-history-dialog" append-to-body>
      <div class="skill-history-panel">
        <div class="skill-history-meta">
          <div><span>技能</span><strong>{{ app.skillHistoryDialog.row?.title || app.skillHistoryDialog.row?.id || '-' }}</strong></div>
          <div><span>仓库路径</span><strong>{{ app.skillHistoryDialog.row?.relativePath || app.skillHistoryDialog.row?.path || '-' }}</strong></div>
        </div>
        <div class="skill-history-list">
          <article v-for="entry in app.skillHistoryDialog.entries" :key="entry.fullCommit || entry.commit" class="skill-history-card">
            <strong>{{ entry.title }}</strong>
            <span>{{ entry.author }} · {{ entry.email }} · {{ app.formatDateTime(entry.time) }}</span>
            <p>{{ entry.summary }}</p>
            <small>{{ entry.commit || '-' }} · 查看提交</small>
          </article>
          <div v-if="!app.skillHistoryDialog.entries.length" class="empty-block">暂无历史版本记录</div>
        </div>
      </div>
    </ElDialog>
  </div>
</section>
</template>

<script>
export default {
  name: 'SkillInventoryView',
  props: {
    app: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      localValidationRows: [],
      loadingLocalValidations: false
    };
  },
  computed: {
    effectiveValidationRows() {
      return this.app.skillValidationRows?.length ? this.app.skillValidationRows : this.localValidationRows;
    },
    validationMappedRows() {
      const rows = this.effectiveValidationRows;
      const sourceKey = [
        rows.length,
        rows.map(row => [
          row.id,
          row.updatedAt,
          row.createdAt,
          row.submittedAt,
          row.artifactName,
          row.researchName,
          row.owner,
          row.validator
        ].join(':')).join('|'),
        this.app.skillValidationRows?.length || 0,
        this.app.skillInventoryRows?.length || 0,
        this.app.skillInventoryValidationCandidateRows?.length || 0,
        this.app.aiAssetSheetRows?.length || 0
      ].join('|');
      if (this._validationRowsCacheKey === sourceKey && Array.isArray(this._validationRowsCache)) {
        return this._validationRowsCache;
      }
      const mappedRows = rows.map(row => this.mapValidationRowForView(row));
      const countMap = new Map();
      mappedRows
        .filter(row => this.app.isDisplayableSkillValidationRecord?.(row))
        .forEach(row => {
          if (!this.app.validationRecordValidatorMatchesSingleOwner?.(row)) return;
          const key = this.app.skillValidationArtifactCountKey?.(row);
          if (!key) return;
          countMap.set(key, (countMap.get(key) || 0) + 1);
        });
      const result = mappedRows.map(row => {
        const key = this.app.skillValidationArtifactCountKey?.(row);
        return {
          ...row,
          validationArtifactCount: key ? (countMap.get(key) || 1) : 1
        };
      });
      this._validationRowsCacheKey = sourceKey;
      this._validationRowsCache = result;
      return result;
    },
    validationMatchedRows() {
      return this.sortValidationRowsByTimeDesc(
        this.validationMappedRows.filter(row => this.app.isDisplayableSkillValidationRecord?.(row))
      );
    },
    validationUnmatchedRows() {
      return this.sortValidationRowsByTimeDesc(
        this.validationMappedRows.filter(row => !this.app.isDisplayableSkillValidationRecord?.(row))
      );
    },
    pagedValidationMatchedRows() {
      return this.validationMatchedRows.slice(
        (this.app.skillValidationPage - 1) * this.app.skillValidationPageSize,
        this.app.skillValidationPage * this.app.skillValidationPageSize
      ).map(row => this.normalizeValidationRowForView(row));
    },
    pagedValidationUnmatchedRows() {
      if (!this.app.skillValidationDetailDrawer) return [];
      return this.validationUnmatchedRows.slice(
        (this.app.skillValidationDetailPage - 1) * this.app.skillValidationDetailPageSize,
        this.app.skillValidationDetailPage * this.app.skillValidationDetailPageSize
      ).map(row => this.normalizeValidationRowForView(row));
    }
  },
  mounted() {
    this._validationRowsCacheKey = '';
    this._validationRowsCache = null;
    this.ensureInventoryRows();
    this.ensureValidationRows();
  },
  watch: {
    'app.activeView': 'ensureRowsForCurrentTab',
    'app.skillInventoryTab': 'ensureRowsForCurrentTab'
  },
  methods: {
    mapValidationRowForView(row = {}) {
      if (!this.app.isSkillValidationScopeRecord?.(row)) {
        return {
          ...row,
          matchedSkillCount: 0,
          matchedMemberSkills: [],
          matchedAiAssets: [],
          matchedInventoryTarget: '',
          validationScopeExcluded: row.forceDisplayInValidation !== true
        };
      }
      let matchedAiAssets = [];
      let matchedMemberSkills = [];
      try {
        matchedAiAssets = this.app.aiAssetRowsForValidation?.(row) || [];
        matchedMemberSkills = this.app.skillRowsForValidation?.(row) || [];
      } catch {
        matchedAiAssets = [];
        matchedMemberSkills = [];
      }
      const mappedOwnerName = this.app.validationMappedOwnerName?.(row, matchedMemberSkills, matchedAiAssets) || '';
      return {
        ...row,
        matchedSkillCount: matchedMemberSkills.length || matchedAiAssets.length,
        matchedMemberSkills,
        matchedAiAssets,
        mappedOwnerName,
        matchedInventoryTarget: matchedMemberSkills.length ? 'members' : matchedAiAssets.length ? 'assets' : '',
        validationScopeExcluded: row.forceDisplayInValidation !== true && !(matchedMemberSkills.length || matchedAiAssets.length)
      };
    },
    viewText(value, fallback = '') {
      if (Array.isArray(value)) {
        const text = value.map(item => this.viewText(item)).filter(Boolean).join('、');
        return text || fallback;
      }
      if (value && typeof value === 'object') {
        const text = value.label || value.name || value.title || value.value || value.text || value.url || value.href || '';
        return String(text || '').trim() || fallback;
      }
      const text = String(value ?? '').trim();
      return text || fallback;
    },
    cleanValidationArtifactPart(value = '') {
      return String(value || '')
        .trim()
        .replace(/^[#\s*[（(「【]+/g, '')
        .replace(/^#\s*/g, '')
        .replace(/[\]）)」】]+$/g, '')
        .replace(/^Skill[：:\s]+/i, '')
        .trim();
    },
    isGenericValidationArtifactName(value = '') {
      const text = this.cleanValidationArtifactPart(value).replace(/\.(md|markdown)$/i, '').toLowerCase();
      if (!text) return true;
      return /^(skill|skills|agents|agent|md|markdown|project|assets?|codex|figma|mcp|git|ai|文件本体)$/.test(text);
    },
    validationArtifactPathParts(value = '') {
      return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(part => this.cleanValidationArtifactPart(part))
        .filter(Boolean);
    },
    preferredValidationArtifactFromPath(value = '') {
      const parts = this.validationArtifactPathParts(value);
      if (!parts.length) return '';
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        const isMarkdown = /\.(md|markdown)$/i.test(part);
        if (isMarkdown && !this.isGenericValidationArtifactName(part)) return part;
        if (isMarkdown && index > 0) {
          const parent = parts[index - 1];
          if (parent && !this.isGenericValidationArtifactName(parent)) return parent;
        }
      }
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (!this.isGenericValidationArtifactName(part)) return part;
      }
      return parts[parts.length - 1] || '';
    },
    validationArtifactDisplay(row = {}) {
      const matchedValues = [
        ...(Array.isArray(row.matchedMemberSkills) ? row.matchedMemberSkills : []).flatMap(item => [
          item.productDisplayName,
          item.productFileName,
          item.title,
          item.relativePath,
          item.path
        ]),
        ...(Array.isArray(row.matchedAiAssets) ? row.matchedAiAssets : []).flatMap(item => [
          item.productDisplayName,
          item.productFileName,
          item.title,
          item.finalPath,
          item.skillPath,
          item.fileLink,
          item.projectName
        ])
      ];
      const sourceGroups = [
        ...matchedValues.map(value => ({ source: 'matched', value })),
        { source: 'location', value: row.artifactLocation },
        { source: 'artifact', value: row.artifactName },
        { source: 'scope', value: row.scope },
        { source: 'research', value: row.researchName }
      ];
      const splitValues = sourceGroups.flatMap(item => String(item.value || '')
        .split(/\s+\/\s+|[，,；;]/)
        .map(value => ({ ...item, value: this.cleanValidationArtifactPart(value) }))
        .filter(entry => entry.value));
      const candidates = splitValues
        .map(item => {
          const pathValue = item.value.replace(/\\/g, '/');
          const display = this.preferredValidationArtifactFromPath(item.value);
          const isMarkdown = /\.(md|markdown)$/i.test(display);
          const isSkillEntry = /(^|\/)skill(s)?\/[^/]+\/skill\.md$/i.test(pathValue)
            || /(^|\/)[^/]+\/skill\.md$/i.test(pathValue);
          return {
            ...item,
            display,
            isMarkdown,
            isSkillEntry,
            isGeneric: this.isGenericValidationArtifactName(display)
          };
        })
        .filter(item => item.display);
      const concreteFile = [...candidates].reverse()
        .find(item => item.isMarkdown && !item.isGeneric && !/^agents\.md$/i.test(item.display))?.display;
      const concreteSkill = candidates.find(item => item.isSkillEntry && !item.isGeneric)?.display;
      const concreteMatchedName = candidates.find(item => item.source === 'matched' && !item.isGeneric)?.display;
      const concreteDirectName = candidates.find(item => item.source !== 'research' && !item.isGeneric)?.display;
      const rawName = this.viewText(row.artifactName || row.scope || row.researchName, '-');
      const cleanedRawName = this.cleanValidationArtifactPart(rawName);
      const unifiedName = this.app.validationDisplayArtifactName?.(row) || '';
      const name = unifiedName
        || concreteFile
        || concreteSkill
        || concreteMatchedName
        || concreteDirectName
        || candidates.find(item => item.source === 'research' && !item.isGeneric && !/^agents\.md$/i.test(item.display))?.display
        || cleanedRawName
        || '-';
      const detail = [
        this.viewText(row.artifactLocation),
        this.viewText(row.researchName),
        this.viewText(row.scope)
      ].filter(Boolean).find(value => value !== name) || '';
      return { name, detail };
    },
    normalizeValidationRowForView(row = {}) {
      const sourceLabel = this.app.skillValidationSourceLabel?.(row) || '-';
      const submittedDateValue = row.submittedAt || row.createdAt || row.importedAt;
      const submittedDateLabel = this.app.formatValidationSubmittedDate?.(submittedDateValue) || '-';
      const submittedDateTimeValue = this.app.validationRecordDisplayTime?.(row) || submittedDateValue;
      const submittedDateTimeLabel = this.app.formatDateSecond?.(submittedDateTimeValue) || submittedDateLabel;
      const artifactNameText = this.viewText(row.artifactName || row.scope || row.researchName, '-');
      const artifactDisplay = this.validationArtifactDisplay(row);
      const validationArtifactCount = Number(row.validationArtifactCount || 0);
      const artifactDisplayName = validationArtifactCount > 1 && this.app.shouldShowValidationArtifactCount?.(row)
        ? `${artifactDisplay.name}（${validationArtifactCount}次）`
        : artifactDisplay.name;
      const statusText = this.viewText(row.status || row.validationResult, '待确认');
      const issuesText = this.viewText(row.issues);
      const notesText = this.viewText(row.notes);
      return {
        ...row,
        id: this.viewText(row.id, `validation-${artifactNameText}-${submittedDateLabel}`),
        sourceLabel,
        submittedDateLabel,
        submittedDateTimeLabel,
        artifactNameText,
        artifactDisplayName,
        artifactDisplayDetail: artifactDisplay.detail,
        researchName: this.viewText(row.researchName),
        validatorName: this.app.validationDisplayValidatorName?.(row)
          || this.app.canonicalArtDeptPerson?.(this.viewText(row.validator))
          || '-',
        ownerName: this.app.validationDisplayOwnerName?.(row, row.matchedMemberSkills, row.matchedAiAssets)
          || this.app.validationMappedOwnerName?.(row, row.matchedMemberSkills, row.matchedAiAssets)
          || this.app.canonicalArtDeptPerson?.(this.viewText(row.owner))
          || '-',
        artifactTypeText: this.viewText(row.artifactType, '-'),
        workflowSceneText: this.viewText(row.workflowScene, '-'),
        statusText,
        evidenceLinkText: this.viewText(row.evidenceLink),
        artifactLocationText: this.viewText(row.artifactLocation, '-'),
        detailNoteText: issuesText || notesText,
        matchedSkillCount: Number(row.matchedSkillCount || 0),
        validationArtifactCount,
        deliverableReady: Boolean(row.deliverableReady)
      };
    },
    validationSortTime(row = {}) {
      const submittedAt = String(row.submittedAt || '').trim();
      const value = Number(row.rowNumber || 0) > 0 && submittedAt
        ? submittedAt
        : submittedAt && !this.app.isDateOnlyValue?.(submittedAt)
        ? submittedAt
        : (row.createdAt || row.importedAt || row.updatedAt || submittedAt || '');
      const normalized = String(value || '').trim().replace(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/, (_, year, month, day) => {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      });
      const parsed = Date.parse(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    sortValidationRowsByTimeDesc(rows = []) {
      return [...rows].sort((a, b) => {
        const timeDiff = this.validationSortTime(b) - this.validationSortTime(a);
        if (timeDiff) return timeDiff;
        const rowDiff = Number(b.rowNumber || 0) - Number(a.rowNumber || 0);
        if (rowDiff) return rowDiff;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
    },
    ensureRowsForCurrentTab() {
      this.ensureInventoryRows();
      this.ensureValidationRows();
    },
    ensureInventoryRows() {
      if (!this.app?.isSkillInventoryViewActive) return;
      if (!['list', 'assets'].includes(this.app?.skillInventoryTab || 'assets')) return;
      this.app.ensureSkillInventoryTabData?.(this.app.skillInventoryTab || 'assets');
    },
    ensureValidationRows() {
      if (!this.app?.isSkillInventoryViewActive) return;
      if (this.app?.skillInventoryTab !== 'validations') return;
      if (this.app?.loading?.skillValidations) return;
      if (Array.isArray(this.app?.skillValidationRows) && this.app.skillValidationRows.length) return;
      if (this.localValidationRows.length) return;
      this.loadValidationRowsForView();
    },
    async loadValidationRowsForView() {
      if (this.loadingLocalValidations) return;
      this.loadingLocalValidations = true;
      try {
        const result = await this.app.refreshSkillValidations?.();
        if (Array.isArray(result.records)) {
          this.localValidationRows = this.app.filterVisibleSkillValidationRecords?.(result.records) || result.records;
        }
      } finally {
        this.loadingLocalValidations = false;
      }
    }
  }
};
</script>

<style lang="scss">
.skill-inventory-view {
  .skill-inventory-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    padding: 0;
  }

  .skill-inventory-panel-header {
    border-bottom: 1px solid var(--line);
    padding: 14px 16px 12px;
  }

  .skill-inventory-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;

    > div:first-child {
      min-width: 0;
    }

    h3 {
      margin: 0;
      color: var(--text);
      font-size: 13px;
      font-weight: 820;
    }

    p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 11px;
      font-weight: 680;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
  }

  .skill-inventory-search {
    width: 240px;
  }

  .skill-validation-log-button {
    flex: 0 0 auto;

    :deep(.el-badge__content) {
      border: 0;
      box-shadow: 0 0 0 1px var(--panel);
    }
  }

  .skill-inventory-filter {
    width: 150px;
  }

  .skill-source-display-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .skill-source-display-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .skill-source-display-toolbar .el-input {
    flex: 0 0 280px;
  }

  .skill-source-display-toolbar span {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .skill-source-display-table .skill-title-cell span {
    white-space: normal;
    word-break: break-all;
  }

  .skill-member-summary {
    display: grid;
    gap: 10px;
    margin-bottom: 16px;
    padding: 8px 14px 12px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }

  .skill-management-tabs {
    margin-bottom: 14px;

    :deep(.el-tabs__header) {
      margin: 0;
    }

    :deep(.el-tabs__item) {
      font-size: 13px;
      font-weight: 820;
    }
  }

  .skill-list-section {
    display: grid;
    gap: 10px;
    margin: 12px 14px 0;
  }

  .skill-document-section {
    display: grid;
    gap: 10px;
    margin: 16px 14px 0;
  }

  .skill-validation-section,
  .art-progress-section {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);
    display: grid;
    gap: 12px;
    margin-bottom: 16px;
    padding: 14px;
  }

  .skill-validation-toolbar-actions {
    align-items: center;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(120px, 1fr) auto;
    min-width: min(340px, 100%);
  }

  .skill-validation-toolbar-left,
  .skill-validation-toolbar-right {
    align-items: center;
    display: flex;
  }

  .skill-validation-toolbar-left {
    justify-content: flex-start;
  }

  .skill-validation-toolbar-right {
    justify-content: flex-end;
  }

  .skill-validation-dialog {
    .el-dialog {
      margin-bottom: 8vh;
      max-width: calc(100vw - 64px);
    }

    .el-dialog__body {
      max-height: calc(84vh - 132px);
      overflow: auto;
      padding-top: 14px;
    }

    .el-dialog__footer {
      border-top: 1px solid var(--line);
      padding: 12px 20px 16px;
    }
  }

  .validation-readonly-value {
    align-items: center;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: color-mix(in srgb, var(--soft-card) 84%, var(--panel) 16%);
    color: var(--text);
    display: flex;
    font-size: 14px;
    font-weight: 760;
    min-height: 38px;
    padding: 0 14px;
  }

  .skill-validation-actions {
    background: transparent !important;
    justify-content: center;
    gap: 6px;
    min-width: 148px;

    .el-button {
      height: 28px;
      min-width: 60px;
      padding-left: 12px;
      padding-right: 12px;
    }
  }

  :global(.skill-validation-dialog) {
    .el-dialog {
      margin-bottom: 8vh;
      max-width: calc(100vw - 64px);
    }

    .el-dialog__body {
      max-height: calc(84vh - 132px);
      overflow: auto;
      padding-top: 14px;
    }

    .el-dialog__footer {
      border-top: 1px solid var(--line);
      padding: 12px 20px 16px;
    }
  }

  .skill-validation-form {
    display: grid;
    gap: 8px;

    :deep(.el-form-item) {
      margin-bottom: 10px;
    }

    :deep(.el-form-item__label) {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
      line-height: 1.2;
      margin-bottom: 6px;
    }
  }

  .skill-validation-form-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;

    &.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    &.three {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .validation-owner-select {
    width: 100%;

    :deep(.el-select__wrapper) {
      height: auto;
      min-height: 34px;
      align-items: flex-start;
      padding-bottom: 4px;
      padding-top: 4px;
    }

    :deep(.el-select__selection) {
      flex-wrap: wrap;
      gap: 4px;
    }
  }

  .dialog-footer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  :global(.art-progress-detail-dialog) {
    .el-dialog__body {
      max-height: calc(86vh - 132px);
      overflow: auto;
      padding-top: 14px;
    }
  }

  .art-progress-preview {
    gap: 14px;
  }

  .art-progress-preview-content {
    display: grid;
    gap: 14px;
  }

  .art-progress-preview-section {
    border-bottom: 1px solid var(--line);
    display: grid;
    gap: 8px;
    padding: 0 0 14px;
  }

  .art-progress-preview-section:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }

  .art-progress-preview-section h2 {
    margin: 0;
    color: var(--heading);
    font-size: 20px;
    font-weight: 880;
    line-height: 1.35;
  }

  .art-progress-preview-meta {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    font-weight: 760;
    line-height: 1.55;
  }

  .art-progress-preview-summary {
    margin: 0;
    color: var(--text);
    font-size: 14px;
    font-weight: 720;
    line-height: 1.75;
    white-space: pre-wrap;
  }

  .art-progress-preview-fields {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .art-progress-preview-fields span {
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--panel);
    color: var(--muted);
    font-size: 12px;
    font-weight: 760;
    line-height: 1.4;
    padding: 4px 8px;
  }


  .skill-validation-metrics,
  .art-progress-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;

    article {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--card);
      display: grid;
      gap: 6px;
      padding: 10px 12px;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    strong {
      color: var(--text);
      font-size: 22px;
      line-height: 1;
    }

    small {
      color: var(--muted);
      font-size: 11px;
      font-weight: 720;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .art-progress-layout {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .art-progress-ranking {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--card);
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 10px;

    header,
    article {
      align-items: center;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }

    header {
      border-bottom: 1px solid var(--line);
      padding-bottom: 8px;
    }

    div {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    strong {
      color: var(--text);
      font-size: 13px;
      font-weight: 860;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span,
    p {
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      margin: 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    b {
      color: var(--primary);
      flex: 0 0 auto;
      font-size: 20px;
      line-height: 1;
    }
  }

  .art-progress-table {
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }

  .skill-validation-owner-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px;

    button {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--row-bg);
      cursor: pointer;
      display: grid;
      gap: 4px;
      min-width: 0;
      padding: 9px 10px;
      text-align: left;

      &:hover {
        border-color: var(--primary);
        background: var(--active-bg);
      }
    }

    strong {
      color: var(--text);
      font-size: 13px;
      font-weight: 860;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .skill-validation-table {
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;

    a {
      color: var(--primary);
      font-weight: 760;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .skill-validation-config-loading {
    align-items: center;
    background: color-mix(in srgb, var(--panel) 90%, var(--primary) 10%);
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--muted);
    display: flex;
    font-size: 13px;
    font-weight: 720;
    min-height: 220px;
    padding: 24px;
  }

  .validation-scope-text {
    border: 0;
    background: transparent;
    display: grid;
    gap: 4px;
    min-width: 0;
    padding: 0;
    text-align: left;

    strong {
      color: var(--primary);
      font-size: 13px;
      font-weight: 860;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
    }
  }

  .skill-member-summary-head {
    align-items: center;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;

    > div:first-child {
      min-width: 0;
    }

    div {
      display: grid;
      gap: 4px;
    }

    strong {
      color: var(--text);
      font-size: 14px;
      font-weight: 860;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
  }

  .skill-member-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .skill-member-card {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--soft-card);
    cursor: pointer;
    min-width: 0;
    min-height: 92px;
    padding: 12px 14px;
    text-align: left;
    transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;

    &:hover {
      border-color: var(--primary);
      background: var(--active-bg);
      box-shadow: var(--lift-shadow);
      transform: translateY(-2px);
    }

    &.active {
      border-color: color-mix(in srgb, var(--primary) 68%, var(--line));
      background: color-mix(in srgb, var(--primary) 14%, var(--card));
      box-shadow:
        inset 4px 0 0 var(--primary),
        inset 0 0 0 1px color-mix(in srgb, var(--primary) 38%, transparent);
      transform: none;
    }
  }

  .skill-product-stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .skill-product-stat-card {
    cursor: default;

    &:hover,
    &:focus-visible {
      background: var(--card);
      border-color: var(--line);
      box-shadow: var(--shadow-soft);
      transform: none;
    }
  }

  .skill-member-card-top {
    align-items: center;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;

    strong {
      color: var(--heading);
      font-size: 15px;
      font-weight: 860;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    b {
      color: var(--heading);
      font-size: 20px;
      line-height: 1;
    }
  }

  .skill-member-uses {
    color: color-mix(in srgb, var(--heading) 76%, var(--muted));
    font-size: 13px;
    font-weight: 720;
    line-height: 1.45;
    margin: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    padding: 0;
  }

  .skill-clean-table {
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: visible;

    :deep(.el-table__cell) {
      font-size: 12px;
      padding: 9px 12px;
      vertical-align: middle;
    }

    :deep(.el-table__header th) {
      background: var(--table-header-bg) !important;
      color: var(--muted);
      font-size: 12px;
      font-weight: 820;
    }

    :deep(.el-table__header th .cell) {
      background: transparent !important;
    }

    :deep(.skill-product-name-column .cell) {
      align-items: center;
      display: flex;
      min-width: 0;
    }

    :deep(.skill-actions-column .cell) {
      align-items: center;
      display: flex;
      justify-content: center;
      overflow: visible;
      padding-left: 8px;
      padding-right: 8px;
    }

    :deep(.el-table__fixed-right),
    :deep(.el-table-fixed-column--right),
    :deep(.el-table-fixed-column--right .cell) {
      background: var(--panel);
      z-index: 3;
    }

    :deep(.el-table__row) {
      min-height: 62px;
    }

    :deep(.el-table__cell) { border-bottom-color: var(--line); }
  }

  .skill-inventory-empty-state {
    align-items: center;
    background: var(--card);
    border: 1px dashed var(--line-strong);
    border-radius: 8px;
    display: grid;
    gap: 10px;
    justify-items: center;
    min-height: 220px;
    padding: 28px;
    text-align: center;
  }

  .skill-inventory-empty-state strong {
    color: var(--heading);
    font-size: 16px;
    font-weight: 860;
  }

  .skill-inventory-empty-state span {
    color: var(--muted);
    font-size: 13px;
    font-weight: 720;
    line-height: 1.6;
    max-width: 520px;
  }

  .skill-inventory-empty-state > div {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  }

  .skill-title-cell {
    display: grid;
    gap: 6px;
    min-width: 0;

    strong {
      color: var(--heading);
      font-size: 15px;
      font-weight: 860;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
  }

  .skill-product-name-stack {
    align-items: stretch;
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .skill-title-button {
    appearance: none;
    background: transparent;
    border: 0;
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
    width: 100%;

    &:hover strong,
    &:focus-visible strong {
      color: var(--primary);
      text-decoration: underline;
    }

    &:disabled {
      cursor: default;
    }

    &:disabled:hover strong,
    &:disabled:focus-visible strong {
      color: var(--heading);
      text-decoration: none;
    }
  }

  .skill-table-text {
    color: var(--text);
    font-size: 12px;
    font-weight: 720;
  }

  .skill-table-number {
    color: var(--text);
    font-size: 13px;
    font-weight: 740;
  }

  .asset-usage-stack {
    align-items: flex-start;
    display: flex;
    flex-direction: column;
    gap: 2px;
    line-height: 1.25;

    small {
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
    }
  }

  .skill-action-links {
    align-items: center;
    background: transparent !important;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    line-height: 1.35;
    min-width: 0;
    overflow: visible;
    width: 100%;
  }

  .skill-action-links button:not(.asset-action-button) {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--primary);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 740;
    padding: 0;
    text-align: left;
  }

  .skill-action-links button:not(.asset-action-button):hover,
  .skill-action-links button:not(.asset-action-button):focus-visible {
    text-decoration: underline;
  }

  .skill-action-links button:not(.asset-action-button).danger {
    color: var(--danger);
  }

  .skill-usage-panel,
  .skill-history-panel {
    display: grid;
    gap: 0;
    align-content: start;
    min-height: 0;
  }

  .skill-usage-member-stats {
    display: grid;
    gap: 8px;
    padding: 0 18px;
  }

  .skill-usage-head {
    align-content: start;
    display: grid;
    gap: 20px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 0;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--soft-card) 72%, var(--panel) 28%), var(--panel));
  }

  .skill-usage-member-stats-head {
    align-items: center;
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .skill-usage-member-stats-head strong {
    color: var(--heading);
    font-size: 13px;
    font-weight: 860;
  }

  .skill-usage-member-stats-head span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 720;
  }

  .skill-usage-member-list {
    display: grid;
    gap: 6px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .skill-usage-member-item {
    align-items: center;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--card);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
    min-height: 40px;
    padding: 7px 9px;
  }

  .skill-usage-member-item > div:first-child,
  .skill-usage-member-item > div:nth-child(2) {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .skill-usage-member-item > div:nth-child(2) {
    align-items: baseline;
    display: flex;
    gap: 4px;
    justify-content: flex-end;
    white-space: nowrap;
  }

  .skill-usage-member-item strong {
    color: var(--heading);
    font-size: 13px;
    font-weight: 860;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skill-usage-member-item b {
    color: var(--primary);
    font-size: 18px;
    font-weight: 860;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  .skill-usage-member-item span,
  .skill-usage-member-item small,
  .skill-usage-member-item time,
  .skill-history-meta span {
    color: var(--muted);
    font-size: 11px;
    font-weight: 720;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skill-usage-title-row {
    align-items: center;
    display: flex;
    gap: 16px;
    justify-content: space-between;
    min-width: 0;
    padding: 20px 18px 0;
  }

  .skill-usage-title-row > div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .skill-usage-title-row span,
  .skill-usage-filter-row > span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 760;
  }

  .skill-usage-title-row strong {
    color: var(--heading);
    font-size: 15px;
    font-weight: 860;
    line-height: 1.35;
    overflow: visible;
    overflow-wrap: anywhere;
    text-overflow: clip;
    white-space: normal;
  }

  .skill-usage-version-badge {
    align-items: flex-end;
    display: grid;
    gap: 3px;
    justify-items: end;
    min-width: 88px;
  }

  .skill-usage-version-badge span {
    color: var(--muted);
    font-size: 11px;
    font-weight: 760;
  }

  .skill-usage-version-badge strong {
    color: var(--primary);
    font-size: 13px;
    font-weight: 860;
    white-space: nowrap;
  }

  .skill-usage-version-note {
    color: var(--text);
    font-size: 12px;
    font-weight: 720;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .skill-usage-history-block {
    display: grid;
    gap: 8px;
    padding: 0 18px 18px;
  }

  .skill-usage-version-list {
    display: grid;
    gap: 8px;
  }

  .skill-usage-version-item {
    align-items: center;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 6px;
    display: grid;
    gap: 6px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-height: 40px;
    padding: 7px 9px;
  }

  .skill-usage-version-item > div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .skill-usage-version-item strong {
    color: var(--heading);
    font-size: 13px;
    font-weight: 860;
    overflow: visible;
    overflow-wrap: anywhere;
    text-overflow: clip;
    white-space: normal;
  }

  .skill-usage-version-item span,
  .skill-usage-version-item small {
    color: var(--muted);
    font-size: 11px;
    font-weight: 720;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skill-usage-head .art-progress-log-empty.compact {
    min-height: 104px;
    padding: 22px 16px;
  }

  .skill-usage-filter-row {
    align-items: center;
    display: grid;
    gap: 10px;
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .skill-usage-filters {
    display: grid;
    grid-template-columns: repeat(2, minmax(180px, 1fr));
    gap: 10px;
    align-items: center;
  }

  .skill-usage-filters :deep(.el-date-editor) {
    width: 100%;
  }

  .skill-usage-log-table {
    max-height: calc(100vh - 378px);
  }

  .skill-usage-log-row {
    grid-template-columns: 150px 120px 110px minmax(220px, .95fr) minmax(280px, 1.2fr) 130px;
  }

  .skill-usage-card-list {
    display: grid;
    gap: 10px;
    max-height: calc(100dvh - 376px);
    min-height: 0;
    overflow: auto;
    padding-right: 4px;
  }

  .skill-usage-card {
    align-items: stretch;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 8px;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) 96px;
    padding: 13px 14px;
    transition: background 0.18s ease, border-color 0.18s ease;
  }

  .skill-usage-card:hover {
    background: color-mix(in srgb, var(--active-bg) 58%, var(--card) 42%);
    border-color: color-mix(in srgb, var(--primary) 34%, var(--line));
  }

  .skill-usage-card-main {
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .skill-usage-card-top,
  .skill-usage-card-actions {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  .skill-usage-card-top {
    justify-content: flex-start;
  }

  .skill-usage-card-top > span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 760;
    font-variant-numeric: tabular-nums;
  }

  .skill-usage-card > .skill-usage-card-main > strong {
    color: var(--heading);
    font-size: 14px;
    font-weight: 860;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .skill-usage-card p {
    color: var(--text);
    display: -webkit-box;
    font-size: 13px;
    font-weight: 720;
    line-height: 1.5;
    margin: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .skill-usage-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
  }

  .skill-usage-card-meta span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 720;
    line-height: 1.35;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .skill-usage-card-meta b {
    color: color-mix(in srgb, var(--heading) 70%, var(--muted));
    font-weight: 820;
    margin-right: 5px;
  }

  .skill-usage-card-actions {
    border-left: 1px solid var(--line);
    justify-content: center;
    padding-left: 12px;
  }

  @media (max-width: 1280px) {
    .skill-usage-member-list {
      grid-template-columns: 1fr;
    }

    .skill-usage-member-item {
      grid-template-columns: minmax(0, 1fr) 96px;
    }
  }

  @media (max-width: 760px) {
    .skill-usage-member-item,
    .skill-usage-version-item,
    .skill-usage-filter-row,
    .skill-usage-filters {
      grid-template-columns: 1fr;
    }

    .skill-usage-title-row,
    .skill-usage-card {
      grid-template-columns: 1fr;
    }

    .skill-usage-title-row {
      align-items: stretch;
      display: grid;
    }

    .skill-usage-card-actions {
      border-left: 0;
      border-top: 1px solid var(--line);
      justify-content: flex-start;
      padding: 10px 0 0;
    }
  }

  .skill-history-list {
    display: grid;
    gap: 10px;
    max-height: 56vh;
    overflow: auto;
    padding-right: 4px;
  }

  .skill-history-card {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
    display: grid;
    gap: 6px;
    padding: 12px;
  }

  .skill-history-card strong {
    color: var(--heading);
    font-size: 13px;
    font-weight: 820;
  }

  .skill-history-card span,
  .skill-history-card small {
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }

  .skill-history-card p {
    color: var(--text);
    font-size: 13px;
    line-height: 1.55;
    margin: 0;
  }

  .skill-history-meta {
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }

  .skill-history-meta div {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
  }

  .skill-history-meta span,
  .skill-history-meta strong {
    border-bottom: 1px solid var(--line);
    padding: 10px 14px;
  }

  .skill-history-meta div:last-child span,
  .skill-history-meta div:last-child strong {
    border-bottom: 0;
  }

  .skill-history-meta span {
    background: var(--soft-card);
  }

  .skill-history-meta strong {
    color: var(--text);
    font-size: 13px;
    font-weight: 760;
    overflow-wrap: anywhere;
  }

  .skill-version-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid transparent;
    background: rgba(100, 116, 139, 0.1);
    color: var(--text);
    font-size: 13px;
    font-weight: 780;
    min-width: 46px;
    padding: 5px 8px;
    position: relative;
  }

  .skill-version-native-select {
    appearance: none;
    background: transparent;
    border: 0;
    cursor: pointer;
    inset: 0;
    opacity: 0;
    position: absolute;
    width: 100%;
  }

  .skill-version-pill.version-1 {
    background: rgba(100, 116, 139, 0.1);
    color: var(--text);
  }

  .skill-version-pill.version-hidden {
    border-color: rgba(148, 163, 184, 0.2);
    background: rgba(148, 163, 184, 0.16);
    color: #94a3b8;
  }

  .skill-version-pill.version-2 {
    border-color: rgba(37, 99, 235, 0.24);
    background: rgba(37, 99, 235, 0.12);
    color: #2563eb;
  }

  .skill-version-pill.version-3 {
    border-color: rgba(22, 163, 74, 0.24);
    background: rgba(22, 163, 74, 0.12);
    color: #15803d;
  }

  .skill-version-pill.version-custom {
    border-color: rgba(147, 51, 234, 0.24);
    background: rgba(147, 51, 234, 0.12);
    color: #7e22ce;
  }

  .skill-scene-text {
    color: var(--muted);
    display: -webkit-box;
    font-size: 12px;
    font-weight: 680;
    line-height: 1.45;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .skill-scene-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    span {
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--chip-bg);
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
      line-height: 1;
      padding: 5px 8px;
    }
  }

  .skill-uploader-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .skill-path-cell {
    display: grid;
    gap: 4px;
    min-width: 0;

    span,
    small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    span {
      color: var(--text);
      font-weight: 760;
    }

    small {
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
    }
  }

  .log-summary-cell {
    span,
    small {
      white-space: normal;
    }
  }


  .ai-asset-filter-bar {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .ai-asset-filter-input {
    width: min(360px, 100%);
  }

  .ai-asset-status-select {
    width: 180px;
  }

  .ai-asset-column-picker {
    display: grid;
    gap: 8px;
    max-height: 320px;
    overflow: auto;
  }

  .skill-validation-head-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
  }

  .skill-validation-column-picker {
    display: grid;
    gap: 8px;
    max-height: 320px;
    overflow: auto;
  }

  .skill-validation-column-picker-actions {
    border-top: 1px solid var(--line);
    display: flex;
    gap: 8px;
    justify-content: space-between;
    margin-top: 4px;
    padding-top: 10px;
  }

  .skill-action-links {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    min-width: 0;
    width: 100%;
    white-space: normal;
  }

  .asset-action-button {
    align-items: center;
    background: var(--control-bg);
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--primary-ink);
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-size: 12px;
    font-weight: 780;
    height: 26px;
    justify-content: center;
    line-height: 1;
    min-width: 48px;
    padding: 0 9px;
    text-decoration: none;
    transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease;

    &:hover,
    &:focus,
    &:focus-visible {
      background: var(--active-bg);
      border-color: color-mix(in srgb, var(--primary) 28%, var(--line-strong));
      color: var(--primary-ink);
      transform: translateY(-1px);
    }

    &:active {
      background: color-mix(in srgb, var(--primary) 10%, var(--control-bg));
      color: var(--primary-ink);
      transform: translateY(0);
    }

    &.danger {
      background: color-mix(in srgb, var(--control-bg) 88%, #fee2e2 12%);
      border-color: color-mix(in srgb, var(--danger) 36%, var(--line));
      color: var(--danger);

      &:hover,
      &:focus,
      &:focus-visible {
        background: color-mix(in srgb, var(--danger) 10%, var(--control-bg));
        border-color: color-mix(in srgb, var(--danger) 58%, var(--line));
        color: var(--danger);
      }

      &:active {
        background: color-mix(in srgb, var(--danger) 14%, var(--control-bg));
        border-color: color-mix(in srgb, var(--danger) 68%, var(--line));
        color: var(--danger);
      }
    }
  }

  .ai-asset-table {
    :deep(.el-table__cell) {
      vertical-align: top;
    }

    :deep(.table-action-row),
    :deep(.skill-validation-actions) {
      background: transparent !important;
      background-color: transparent !important;
    }

    :deep(.el-table__fixed-right) {
      box-shadow: -8px 0 18px rgba(15, 23, 42, 0.08);
    }
  }

  .ai-asset-path-cell {
    align-items: start;
    grid-template-columns: minmax(0, 1fr) auto;

    span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    small {
      grid-column: 1 / -1;
    }
  }

  .art-progress-log-button {
    flex: 0 0 auto;
  }

  .skill-member-summary-head > .art-progress-actions,
  .art-progress-actions {
    align-items: center;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
    min-width: 0;
    width: auto;
  }

  @media (max-width: 1100px) {
    .skill-inventory-toolbar {
      align-items: stretch;
      flex-direction: column;
    }

    .skill-member-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .skill-validation-metrics,
    .art-progress-metrics,
    .art-progress-layout,
    .skill-validation-form-grid,
    .skill-validation-form-grid.two,
    .skill-validation-form-grid.three {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .panel-actions:not(.art-progress-actions),
    .skill-inventory-search,
    .skill-inventory-filter {
      width: 100%;
    }

    .skill-member-summary-head > .art-progress-actions,
    .art-progress-actions {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      width: auto;
    }
  }

  @media (max-width: 720px) {
    .skill-member-grid,
    .skill-validation-metrics,
    .art-progress-metrics,
    .art-progress-layout,
    .skill-validation-form-grid,
    .skill-validation-form-grid.two,
    .skill-validation-form-grid.three {
      grid-template-columns: 1fr;
    }

  }
}
</style>
