<template>
<section v-show="app.activeView === 'skill-inventory'" class="view-grid skill-inventory-view">
  <ElCard shadow="never" class="panel-card page-card">
    <template #header>
      <div class="skill-inventory-toolbar">
        <div>
          <h3>{{ app.skillInventoryTab === 'validations' ? '验证回填' : app.skillInventoryTab === 'assets' ? 'AI 产物清单' : app.skillInventoryTab === 'events' ? '研究同步' : '产物列表' }}</h3>
          <p>{{ app.skillInventoryTab === 'validations' ? '验证回填可一键映射到产物列表查看对应沉淀。' : app.skillInventoryTab === 'assets' ? '上方成员卡片按已沉淀产物展示，下方列表读取资料库管理接入项目的当前产物。' : app.skillInventoryTab === 'events' ? '上方为组员 Codex 自动上报研究同步，下方为 Google 表人工研究清单。' : '成员产物和下方产物列表均来自资料库管理接入项目。' }}</p>
        </div>
        <div class="panel-actions art-progress-actions">
          <ElInput
            v-if="app.skillInventoryTab === 'list' || app.skillInventoryTab === 'assets'"
            v-model="app.skillInventoryKeyword"
            clearable
            class="skill-inventory-search"
            placeholder="搜索产物、上传者、场景"
          />
          <ElTooltip :content="app.skillInventoryRefreshHint" placement="top" effect="dark">
            <ElButton :loading="app.loading.scan" @click="app.scanAllProjects">刷新库存</ElButton>
          </ElTooltip>
          <template v-if="app.skillInventoryTab === 'validations'">
            <ElButton :loading="app.loading.skillValidations" @click="app.forceRefreshSkillValidations">刷新验证</ElButton>
            <ElButton v-if="app.can('skill.validation.manage')" type="primary" @click="app.openSkillValidationCreate">新增回填</ElButton>
            <ElTooltip v-if="app.canViewSkillValidationLogs" content="查看未映射到 AI 产物清单的验证明细" placement="top" effect="dark">
              <button type="button" class="top-log-icon-button skill-validation-log-button" aria-label="验证明细" @click="app.openSkillValidationDetailDrawer">
                <ElBadge :value="validationUnmatchedRows.length" :hidden="!validationUnmatchedRows.length" :max="99">
                  <ElIcon><Tickets /></ElIcon>
                </ElBadge>
              </button>
            </ElTooltip>
          </template>
          <ElButton
            v-if="(app.skillInventoryTab === 'list' || app.skillInventoryTab === 'assets') && app.canManageSkillAssets"
            :type="app.skillInventoryShowHidden ? 'primary' : undefined"
            @click="app.toggleSkillInventoryHiddenView"
          >
            {{ app.skillInventoryShowHidden ? '返回清单' : '查看已隐藏' }}
          </ElButton>
          <ElButton v-if="(app.skillInventoryTab === 'list' || app.skillInventoryTab === 'assets') && app.canManageSkillAssets" type="primary" @click="app.openManualSkillCreate">手动创建</ElButton>
        </div>
      </div>
    </template>

    <div v-show="app.skillInventoryTab === 'list' || app.skillInventoryTab === 'assets'" class="skill-member-summary">
      <div class="skill-member-summary-head">
        <div>
          <strong>成员产物整合</strong>
          <span>按 AI 部门看板里的累计产物展示；下方产物列表来自资料库管理扫描，数量允许不完全一致。</span>
        </div>
      </div>
      <div class="skill-member-grid">
        <button
          type="button"
          :class="['skill-member-card', { active: !app.skillInventoryMemberFilter }]"
          @click="app.applySkillInventoryMemberFilter('')"
        >
          <div class="skill-member-card-top">
            <strong>部门累计</strong>
            <b>{{ app.skillInventoryMemberOverview.productSkillCount }}</b>
          </div>
          <p class="skill-member-uses">成员实际完成产物累计</p>
        </button>
        <button
          v-for="member in app.skillInventoryMemberSummaries"
          :key="member.name"
          type="button"
          :class="['skill-member-card', { active: app.skillInventoryMemberFilter === member.name }]"
          @click="app.applySkillInventoryMemberFilter(member.name)"
        >
          <div class="skill-member-card-top">
            <strong>{{ member.name }}</strong>
            <b>{{ member.totalSkillCount }}</b>
          </div>
          <p class="skill-member-uses">{{ member.productNames || '暂无明确产物' }}</p>
        </button>
      </div>
    </div>

    <div v-if="app.skillInventoryTab === 'validations'" class="skill-validation-section">
      <div class="skill-member-summary-head">
        <div>
          <strong>产物验证区</strong>
          <span>读取部门验证表第 {{ app.skillValidationMeta?.startRow || 31 }} 行之后的正式记录，并合并成员自动上报的验证回填。</span>
        </div>
        <div class="skill-validation-head-actions">
          <small>当前 {{ validationMatchedRows.length }} 条</small>
          <ElPopover v-if="app.taskCenterConfigReady && app.canManageSkillValidationColumns" placement="bottom-end" trigger="click" width="280">
            <template #reference>
              <ElButton size="small">字段显示</ElButton>
            </template>
            <div class="skill-validation-column-picker">
              <ElCheckbox
                v-for="column in app.skillValidationColumnOptions()"
                :key="column.key"
                :model-value="app.isSkillValidationColumnVisible(column.key)"
                @update:model-value="checked => app.setSkillValidationColumnVisible(column.key, checked)"
              >
                {{ column.label }}
              </ElCheckbox>
              <div class="skill-validation-column-picker-actions">
                <ElButton size="small" plain @click="app.showAllSkillValidationColumns">全部恢复</ElButton>
                <ElButton size="small" type="primary" @click="app.saveSkillValidationColumnConfig">保存字段</ElButton>
              </div>
            </div>
          </ElPopover>
        </div>
      </div>
      <div v-if="!app.taskCenterConfigReady" class="skill-validation-config-loading">
        正在读取字段配置...
      </div>
      <ElTable
        v-else
        class="skill-validation-table"
        :data="pagedValidationMatchedRows"
        row-key="id"
        size="small"
        empty-text="暂无验证回填记录"
        >
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('source')" label="来源" width="80">
          <template #default="{ row }">{{ row.sourceLabel }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('submittedDate')" label="提交日期" width="115">
          <template #default="{ row }">{{ row.submittedDateLabel }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('artifactName')" label="产物文件名" min-width="210">
          <template #default="{ row }">
            <div class="validation-scope-text">
              <strong>{{ row.artifactDisplayName }}</strong>
              <span v-if="row.artifactDisplayDetail">{{ row.artifactDisplayDetail }}</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('validator')" label="验证人" width="110">
          <template #default="{ row }">{{ row.validatorName }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('owner')" label="贡献人" width="110">
          <template #default="{ row }">{{ row.ownerName }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('artifactType')" label="产物类型" width="100">
          <template #default="{ row }">{{ row.artifactTypeText }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('workflowScene')" label="工作场景" width="130">
          <template #default="{ row }">{{ row.workflowSceneText }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('validationResult')" label="验证结果" width="150">
          <template #default="{ row }">
            <ElTag :type="row.deliverableReady ? 'success' : row.statusText === '待确认' ? 'info' : 'warning'" size="small">{{ row.statusText }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('mapping')" label="清单映射" width="110">
          <template #default="{ row }">
            <button type="button" class="archive-count-link" @click.stop="app.openSkillInventoryFromValidation(row)">
              {{ row.matchedSkillCount ? row.matchedSkillCount : '未映射' }}
            </button>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('validationInfo')" label="验证信息" min-width="320">
          <template #default="{ row }">
            <div class="skill-path-cell">
              <a v-if="row.evidenceLinkText" :href="row.evidenceLinkText" target="_blank" rel="noreferrer">{{ row.evidenceLinkText }}</a>
              <span v-else>{{ row.artifactLocationText }}</span>
              <small v-if="row.detailNoteText">{{ row.detailNoteText }}</small>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isSkillValidationColumnVisible('actions')" label="操作" width="172" fixed="right" align="center" class-name="skill-validation-actions-column">
          <template #default="{ row }">
            <div class="table-action-row skill-validation-actions">
              <ElButton size="small" type="primary" plain @click="app.openSkillValidationEdit(row)">修改</ElButton>
              <ElButton v-if="app.can('skill.validation.manage')" size="small" type="danger" plain @click="app.deleteSkillValidation(row)">删除</ElButton>
            </div>
          </template>
        </ElTableColumn>
      </ElTable>
      <div class="pagination-bar skill-validation-pagination">
        <span>共 {{ validationMatchedRows.length }} 条</span>
        <ElPagination
          :current-page="app.skillValidationPage"
          @update:current-page="value => app.skillValidationPage = value"
          :page-size="app.skillValidationPageSize"
          @update:page-size="value => app.setWorkbenchPageSize(value, 'skillValidationPage')"
          :page-sizes="[10, 50, 100]"
          :total="validationMatchedRows.length"
          page-size-label="条/页"
          layout="sizes, prev, pager, next"
        />
      </div>

      <ElDrawer
        v-model="app.skillValidationDetailDrawer"
        title="验证明细"
        direction="rtl"
        size="50%"
        class="app-dialog art-progress-log-drawer skill-validation-detail-drawer"
        append-to-body
        :with-header="true"
      >
        <div class="skill-validation-detail-panel">
          <div class="art-progress-log-toolbar skill-validation-detail-toolbar">
            <span>以下为不属于验证回填范畴的历史记录；Google 刷新记录和自动上报记录会保留在主列表展示。</span>
          </div>
          <div class="art-progress-log-table skill-validation-detail-table">
            <div class="art-progress-log-row skill-validation-detail-row head">
              <span>提交日期</span>
              <span>来源</span>
              <span>验证人</span>
              <span>贡献人</span>
              <span>产物文件名</span>
              <span>验证结果</span>
              <span class="art-progress-log-action-head">操作</span>
            </div>
            <div v-if="validationUnmatchedRows.length" class="art-progress-log-body">
              <div v-for="row in pagedValidationUnmatchedRows" :key="row.id" class="art-progress-log-row skill-validation-detail-row">
                <span>{{ row.submittedDateTimeLabel || row.submittedDateLabel }}</span>
                <span>{{ row.sourceLabel }}</span>
                <span>{{ row.validatorName }}</span>
                <span>{{ row.ownerName }}</span>
                <span>
                  <strong>{{ row.artifactDisplayName }}</strong>
                  <small v-if="row.artifactDisplayDetail">{{ row.artifactDisplayDetail }}</small>
                </span>
                <span>
                  <ElTag v-if="row.validationScopeExcluded" type="info" size="small">非验证范畴</ElTag>
                  <ElTag v-else :type="row.deliverableReady ? 'success' : row.statusText === '待确认' ? 'info' : 'warning'" size="small">{{ row.statusText }}</ElTag>
                </span>
                <span class="art-progress-log-actions">
                  <ElButton size="small" type="primary" plain @click="app.openSkillValidationEdit(row)">查看内容</ElButton>
                  <ElButton
                    v-if="app.canBackfillSkillValidationDetailLogs"
                    size="small"
                    type="success"
                    plain
                    :disabled="app.isSkillValidationDetailBackfilled(row)"
                    @click="app.backfillSkillValidation(row)"
                  >{{ app.isSkillValidationDetailBackfilled(row) ? '已回填' : '回填' }}</ElButton>
                  <ElButton v-if="app.canDeleteSkillValidationDetailLogs" size="small" type="danger" plain @click="app.deleteSkillValidation(row)">删除</ElButton>
                </span>
              </div>
            </div>
            <div v-else class="art-progress-log-empty">暂无未映射验证明细</div>
          </div>
          <div v-if="validationUnmatchedRows.length" class="pagination-bar art-progress-log-pagination">
            <span>共 {{ validationUnmatchedRows.length }} 条</span>
            <ElPagination
              :current-page="app.skillValidationDetailPage"
              @update:current-page="value => app.skillValidationDetailPage = value"
              :page-size="app.skillValidationDetailPageSize"
              @update:page-size="value => app.setWorkbenchPageSize(value, 'skillValidationDetailPage')"
              :page-sizes="[10, 50, 100]"
              :total="validationUnmatchedRows.length"
              page-size-label="条/页"
              layout="sizes, prev, pager, next"
            />
          </div>
        </div>
      </ElDrawer>

      <ElDialog
        v-model="app.skillValidationDialog.visible"
        title="验证回填"
        width="1040px"
        top="8vh"
        class="app-dialog skill-validation-dialog"
        append-to-body
        :close-on-click-modal="false"
        :lock-scroll="true"
      >
        <ElForm :model="app.skillValidationDialog.form" label-position="top" class="skill-validation-form">
          <div class="skill-validation-form-grid">
            <ElFormItem label="提交日期">
              <div class="validation-readonly-value">{{ app.skillValidationDialog.form.submittedAt }}</div>
            </ElFormItem>
            <ElFormItem label="验证人">
              <ElSelect v-model="app.skillValidationDialog.form.validator" filterable allow-create default-first-option clearable placeholder="选择验证人">
                <ElOption v-for="person in app.skillValidationPersonOptions" :key="`validator-${person}`" :label="person" :value="person" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="贡献人">
              <ElSelect v-model="app.skillValidationDialog.form.ownerList" class="validation-owner-select" :disabled="!app.canManageSkillValidationOwner" multiple filterable allow-create default-first-option clearable placeholder="选择贡献人">
                <ElOption v-for="person in app.skillValidationPersonOptions" :key="`owner-${person}`" :label="person" :value="person" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="产物类型">
              <ElSelect v-model="app.skillValidationDialog.form.artifactType" filterable allow-create default-first-option clearable placeholder="选择类型">
                <ElOption label="md" value="md" />
                <ElOption label="figma" value="figma" />
                <ElOption label="image" value="image" />
                <ElOption label="psd" value="psd" />
                <ElOption label="other" value="other" />
              </ElSelect>
            </ElFormItem>
          </div>
          <div class="skill-validation-form-grid two">
            <ElFormItem label="研究项名称">
              <ElInput v-model="app.skillValidationDialog.form.researchName" placeholder="例如：研究 AI 资源命名" />
            </ElFormItem>
            <ElFormItem label="产物文件名">
              <ElInput v-model="app.skillValidationDialog.form.artifactName" placeholder="例如：Figma 切图命名规范文档" />
            </ElFormItem>
          </div>
          <div class="skill-validation-form-grid two">
            <ElFormItem label="产物链接 / 位置">
              <ElInput v-model="app.skillValidationDialog.form.artifactLocation" placeholder="文件路径、共享盘位置或资料库路径" />
            </ElFormItem>
            <ElFormItem label="对应工作流场景">
              <ElInput v-model="app.skillValidationDialog.form.workflowScene" placeholder="需求拆解 / 资源命名 / 切图等" />
            </ElFormItem>
          </div>
          <div class="skill-validation-form-grid two">
            <ElFormItem label="输入资料">
              <ElInput v-model="app.skillValidationDialog.form.inputMaterial" placeholder="Figma / 需求 / 参考资料链接" />
            </ElFormItem>
            <ElFormItem label="输出证据链接">
              <ElInput v-model="app.skillValidationDialog.form.evidenceLink" placeholder="验证后的 Figma / 产物 / 截图链接" />
            </ElFormItem>
          </div>
          <div class="skill-validation-form-grid three">
            <ElFormItem label="任务单号">
              <ElInput v-model="app.skillValidationDialog.form.validationTask" placeholder="禅道单号或链接，可空" />
            </ElFormItem>
            <ElFormItem label="是否本人创建">
              <ElSelect v-model="app.skillValidationDialog.form.selfCreated" clearable placeholder="选择">
                <ElOption label="是" value="是" />
                <ElOption label="否" value="否" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="验证结果">
              <ElSelect v-model="app.skillValidationDialog.form.validationResult" filterable allow-create default-first-option clearable placeholder="选择或输入结果">
                <ElOption label="可直接复用" value="可直接复用" />
                <ElOption label="部分可用需修改" value="部分可用需修改" />
                <ElOption label="场景不匹配暂不判断" value="场景不匹配暂不判断" />
                <ElOption label="资料不完整" value="资料不完整" />
                <ElOption label="不可用需重做" value="不可用需重做" />
              </ElSelect>
            </ElFormItem>
          </div>
          <div class="skill-validation-form-grid three">
            <ElFormItem label="人工修改量">
              <ElInput v-model="app.skillValidationDialog.form.manualChange" placeholder="待评估 / 少量 / 中等 / 大量" />
            </ElFormItem>
            <ElFormItem label="节省 / 增加时间估算">
              <ElInput v-model="app.skillValidationDialog.form.timeEstimate" placeholder="待评估" />
            </ElFormItem>
            <ElFormItem label="是否建议部门内复用">
              <ElSelect v-model="app.skillValidationDialog.form.reuseAdvice" filterable allow-create default-first-option clearable placeholder="选择或输入建议">
                <ElOption label="建议小范围复用" value="建议小范围复用" />
                <ElOption label="建议部门内复用" value="建议部门内复用" />
                <ElOption label="待判断" value="待判断" />
                <ElOption label="-" value="-" />
              </ElSelect>
            </ElFormItem>
          </div>
          <ElFormItem label="验证问题 / 改进点">
            <ElInput v-model="app.skillValidationDialog.form.issues" type="textarea" :rows="3" placeholder="记录验证过程中发现的问题、输出不稳定点或需要手动修正的位置" />
          </ElFormItem>
          <ElFormItem label="建议怎么改">
            <ElInput v-model="app.skillValidationDialog.form.suggestion" type="textarea" :rows="2" placeholder="写给贡献人或后续维护人的修改建议" />
          </ElFormItem>
          <ElFormItem label="备注">
            <ElInput v-model="app.skillValidationDialog.form.notes" type="textarea" :rows="2" placeholder="补充适用/不适用任务、是否需要补材料等判断" />
          </ElFormItem>
        </ElForm>
        <template #footer>
          <div class="dialog-footer-actions">
            <ElButton @click="app.closeSkillValidationDialog">取消</ElButton>
            <ElButton v-if="app.can('skill.validation.manage')" type="primary" :loading="app.loading.skillValidations" @click="app.saveSkillValidation">保存回填</ElButton>
          </div>
        </template>
      </ElDialog>
    </div>

    <ElDialog
      v-model="app.aiAssetDialog.visible"
      :title="app.aiAssetDialog.readonly ? '人工研究记录明细' : '人工研究记录'"
      width="940px"
      top="8vh"
      class="app-dialog skill-validation-dialog"
      append-to-body
      :close-on-click-modal="false"
    >
      <ElForm :model="app.aiAssetDialog.form" label-position="top" class="skill-validation-form">
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
          <ElButton v-if="app.canManageSkillAssets && !app.aiAssetDialog.readonly" type="primary" :loading="app.loading.aiAssetSheet" @click="app.saveAiAsset">保存</ElButton>
        </div>
      </template>
    </ElDialog>

    <div v-show="app.skillInventoryTab === 'events'" class="art-progress-section">
      <div class="skill-member-summary-head">
        <div>
          <strong>自动同步明细</strong>
          <span>这里展示组员电脑自动上报的 Codex 使用、研究进展、工具/Skill 试用和复盘结论。</span>
        </div>
        <div class="panel-actions art-progress-actions">
          <ElTooltip :content="app.artProgressRefreshHint" placement="top" effect="dark">
            <ElButton size="small" :loading="app.loading.artProgressEvents" @click="app.refreshArtProgressEvents">刷新同步</ElButton>
          </ElTooltip>
          <ElTooltip v-if="app.canViewArtProgressOperationLog" content="接入记录与操作记录" placement="top" effect="dark">
            <button type="button" class="top-log-icon-button art-progress-log-button" aria-label="操作记录" @click="app.openArtProgressLogDrawer">
              <ElIcon>
                <Clock />
              </ElIcon>
            </button>
          </ElTooltip>
        </div>
      </div>
      <div class="art-progress-metrics">
        <article v-for="metric in app.artProgressMetricCards" :key="metric.label">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
          <small>{{ metric.hint }}</small>
        </article>
      </div>
      <div class="art-progress-layout">
        <section class="art-progress-ranking">
          <header>
            <strong>成员同步</strong>
            <span>按同步数量排序</span>
          </header>
          <article v-for="member in app.artProgressMemberRows" :key="member.label">
            <div>
              <strong>{{ member.label }}</strong>
              <span>待补材料 {{ member.blocked }} · 阶段结论 {{ member.completed }}</span>
            </div>
            <b>{{ member.count }}</b>
          </article>
          <p v-if="!app.artProgressMemberRows.length">暂无成员同步</p>
        </section>
        <section class="art-progress-ranking">
          <header>
            <strong>工具与 Skill</strong>
            <span>按工具或 Skill 聚合</span>
          </header>
          <article v-for="skill in app.artProgressSkillRows" :key="skill.label">
            <div>
              <strong>{{ skill.label }}</strong>
              <span>待补材料 {{ skill.blocked }} · 阶段结论 {{ skill.completed }}</span>
            </div>
            <b>{{ skill.count }}</b>
          </article>
          <p v-if="!app.artProgressSkillRows.length">暂无工具或 Skill 记录</p>
        </section>
      </div>
      <ElTable
        class="art-progress-table"
        :data="app.pagedArtProgressEvents"
        row-key="id"
        size="small"
        empty-text="暂无有进度的研究事项"
      >
        <ElTableColumn label="时间" width="150">
          <template #default="{ row }">{{ app.formatDateOnly(row.createdAt) }}</template>
        </ElTableColumn>
        <ElTableColumn label="类型" width="120">
          <template #default="{ row }">
            <ElTag :type="app.artProgressStatusType(row.status, row.eventType)" size="small">
              {{ app.artProgressEventTypeLabel(row.eventType) }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="成员" width="130">
          <template #default="{ row }">{{ row.displayMemberName || '-' }}</template>
        </ElTableColumn>
        <ElTableColumn label="工具 / 主题" min-width="320">
          <template #default="{ row }">
            <div class="skill-path-cell">
              <span>{{ row.displaySkillName || '-' }}</span>
              <small v-if="row.displayStage">{{ row.displayStage }}</small>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="禅道任务" width="120">
          <template #default="{ row }">{{ row.zentaoTaskId || row.taskNo || '-' }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="app.canManageArtProgress" label="操作" width="96" fixed="right" align="center">
          <template #default="{ row }">
            <div class="table-action-row skill-validation-actions">
              <ElButton size="small" type="danger" plain @click="app.deleteArtProgressEvent(row)">删除</ElButton>
            </div>
          </template>
        </ElTableColumn>
      </ElTable>
      <div class="pagination-bar art-progress-pagination">
        <span>研究列表共 {{ app.researchArtProgressEvents.length }} 条</span>
        <ElPagination
          :current-page="app.artProgressPage"
          @update:current-page="value => app.artProgressPage = value"
          :page-size="app.artProgressPageSize"
          @update:page-size="value => app.setWorkbenchPageSize(value, 'artProgressPage')"
          :page-sizes="[10, 50, 100]"
          :total="app.researchArtProgressEvents.length"
          page-size-label="条/页"
          layout="sizes, prev, pager, next, jumper"
        />
      </div>

      <ElDialog
        v-model="app.artProgressDetailDialog.visible"
        :title="app.artProgressDetailDialog.title || '查看内容'"
        width="860px"
        top="7vh"
        class="app-dialog skill-preview-dialog art-progress-detail-dialog"
        append-to-body
        :lock-scroll="true"
      >
        <div class="skill-preview art-progress-preview">
          <div class="skill-preview-head">
            <div>
              <strong>{{ app.artProgressDetailDialog.headTitle || app.artProgressDetailDialog.title || '研究内容' }}</strong>
              <span>{{ app.artProgressDetailDialog.path || '研究同步记录' }}</span>
            </div>
            <div class="skill-preview-tags">
              <ElTag
                v-for="tag in app.artProgressDetailDialog.tags"
                :key="tag"
                size="small"
                effect="plain"
              >{{ tag }}</ElTag>
            </div>
          </div>
          <div v-if="app.artProgressDetailDialog.meta.length" class="skill-preview-meta">
            <span v-for="item in app.artProgressDetailDialog.meta" :key="item.label">{{ item.label }}：{{ item.value }}</span>
          </div>
          <p>{{ app.artProgressDetailDialog.description || '暂无简介。' }}</p>
          <div class="skill-trigger-list">
            <span v-for="trigger in app.artProgressDetailDialog.triggers" :key="trigger">{{ trigger }}</span>
            <span v-if="!app.artProgressDetailDialog.triggers.length">暂无标签</span>
          </div>
          <article class="markdown-report skill-preview-content art-progress-preview-content">
            <template v-if="app.artProgressDetailDialog.rows.length">
              <section
                v-for="row in app.artProgressDetailDialog.rows"
                :key="row.id || row.createdAt || row.displaySkillName"
                class="art-progress-preview-section"
              >
                <h2>{{ row.displaySkillName || row.title || '研究事项' }}</h2>
                <p class="art-progress-preview-meta">
                  {{ app.artProgressEventTypeLabel(row.eventType) }} · {{ row.displayMemberName || '-' }} · {{ app.formatDateTime(row.createdAt) || '-' }}
                </p>
                <p class="art-progress-preview-summary">{{ row.displaySummary || row.summary || '暂无具体说明。' }}</p>
                <div class="art-progress-preview-fields">
                  <span v-if="row.displayStage || row.stage">阶段：{{ row.displayStage || row.stage }}</span>
                  <span v-if="row.displayProjectName || row.projectName">项目：{{ row.displayProjectName || row.projectName }}</span>
                  <span v-if="row.zentaoTaskId || row.taskNo">禅道任务：{{ row.zentaoTaskId || row.taskNo }}</span>
                </div>
              </section>
            </template>
            <div v-else class="empty-block">暂无可查看内容</div>
          </article>
        </div>
      </ElDialog>

      <ElDrawer
        v-model="app.artProgressLogDialog"
        title="操作日志"
        direction="rtl"
        size="50%"
        class="app-dialog art-progress-log-drawer"
        append-to-body
        :with-header="true"
      >
        <div class="art-progress-log-toolbar">
          <ElSegmented
            class="art-progress-log-segment"
            :model-value="app.artProgressLogType"
            :options="app.artProgressLogTypeOptions"
            @update:model-value="value => { app.artProgressLogType = value; app.artProgressLogPage = 1; }"
          />
          <ElSelect
            v-model="app.artProgressLogMemberFilter"
            class="art-progress-log-member-filter"
            clearable
            filterable
            placeholder="筛选人员"
            @change="app.artProgressLogPage = 1"
          >
            <ElOption v-for="name in app.artProgressLogMemberOptions" :key="name" :label="name" :value="name" />
          </ElSelect>
          <span>{{ app.artProgressLogType === 'operation' ? '成员各自电脑 Codex 使用的操作上报明细。' : '接入完成和连接测试记录。' }}</span>
        </div>
        <div class="art-progress-log-table">
          <div class="art-progress-log-row head">
            <span>时间</span>
            <span>类型</span>
            <span>成员</span>
            <span>工具 / 主题</span>
            <span>摘要</span>
            <span class="art-progress-log-action-head">操作</span>
          </div>
          <div v-if="app.filteredArtProgressLogEvents.length" class="art-progress-log-body">
            <div v-for="row in app.pagedArtProgressLogEvents" :key="row.id" class="art-progress-log-row">
              <span>{{ app.formatDateSecond(row.createdAt) || '-' }}</span>
              <span>
                <ElTag :type="app.artProgressStatusType(row.status, row.eventType)" size="small">
                  {{ app.artProgressEventTypeLabel(row.eventType) }}
                </ElTag>
              </span>
              <span>{{ row.displayMemberName || '-' }}</span>
              <span>
                <strong>{{ row.displaySkillName || '-' }}</strong>
                <small v-if="row.displayStage">{{ row.displayStage }}</small>
              </span>
              <span class="art-progress-log-summary-cell">
                <strong>{{ app.truncateText(row.displaySummary || '-', 72) }}</strong>
                <small v-if="row.displayProjectName">{{ row.displayProjectName }}</small>
              </span>
              <span class="art-progress-log-actions">
                <ElButton
                  v-if="app.canManageArtProgress && app.artProgressLogType === 'operation'"
                  size="small"
                  type="success"
                  plain
                  :disabled="app.isArtProgressLogDisplayed(row)"
                  @click="app.showArtProgressLogInResearchList(row)"
                >{{ app.isArtProgressLogDisplayed(row) ? '已展示' : '展示' }}</ElButton>
                <ElButton size="small" type="primary" plain @click="app.openArtProgressDetail('log', row)">查看内容</ElButton>
                <ElButton v-if="app.canManageArtProgressLogs" size="small" type="danger" plain @click="app.deleteArtProgressLogRow(row)">删除</ElButton>
              </span>
            </div>
          </div>
          <div v-else class="art-progress-log-empty">{{ app.artProgressLogType === 'operation' ? '暂无 Codex 操作记录' : '暂无接入测试记录' }}</div>
        </div>
        <div v-if="app.filteredArtProgressLogEvents.length" class="pagination-bar art-progress-log-pagination">
          <span>共 {{ app.filteredArtProgressLogEvents.length }} 条</span>
          <ElPagination
            :current-page="app.artProgressLogPage"
            @update:current-page="value => app.artProgressLogPage = value"
            :page-size="app.artProgressLogPageSize"
            @update:page-size="value => app.setWorkbenchPageSize(value, 'artProgressLogPage')"
            :page-sizes="[10, 50, 100]"
            :total="app.filteredArtProgressLogEvents.length"
            page-size-label="条/页"
            layout="sizes, prev, pager, next"
          />
        </div>
      </ElDrawer>

      <ElDialog
        v-model="app.artProgressDialog.visible"
        title="研究同步"
        width="760px"
        top="10vh"
        class="app-dialog skill-validation-dialog"
        append-to-body
        :close-on-click-modal="false"
        :lock-scroll="true"
      >
        <ElForm :model="app.artProgressDialog.form" label-position="top" class="skill-validation-form">
          <div class="skill-validation-form-grid three">
            <ElFormItem label="同步类型">
              <ElSelect v-model="app.artProgressDialog.form.eventType" placeholder="选择类型">
                <ElOption label="开始研究" value="research_started" />
                <ElOption label="研究过程" value="research_progress" />
                <ElOption label="工具使用" value="tool_used" />
                <ElOption label="研究发现" value="research_finding" />
                <ElOption label="产物沉淀" value="research_artifact" />
                <ElOption label="待补材料" value="research_blocked" />
                <ElOption label="阶段总结" value="research_summary" />
                <ElOption label="接入完成" value="reporter_installed" />
                <ElOption label="连接测试" value="reporter_test" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="成员姓名">
              <ElInput v-model="app.artProgressDialog.form.memberName" placeholder="成员姓名" />
            </ElFormItem>
            <ElFormItem label="成员账号">
              <ElInput v-model="app.artProgressDialog.form.memberAccount" placeholder="登录账号" />
            </ElFormItem>
          </div>
          <div class="skill-validation-form-grid two">
            <ElFormItem label="研究主题">
              <ElInput v-model="app.artProgressDialog.form.title" placeholder="例如：AI资源命名研究" />
            </ElFormItem>
            <ElFormItem label="阶段 / 主题">
              <ElInput v-model="app.artProgressDialog.form.stage" placeholder="例如：资源命名反例验证" />
            </ElFormItem>
          </div>
          <div class="skill-validation-form-grid two">
            <ElFormItem label="工具或 Skill 名称">
              <ElInput v-model="app.artProgressDialog.form.skillName" placeholder="例如：Figma 图层整理" />
            </ElFormItem>
            <ElFormItem label="工具或 Skill ID">
              <ElInput v-model="app.artProgressDialog.form.skillId" placeholder="例如：figma-layer-cleanup" />
            </ElFormItem>
          </div>
          <div class="skill-validation-form-grid two">
            <ElFormItem label="项目 / 内容来源">
              <ElInput v-model="app.artProgressDialog.form.projectName" placeholder="项目名或内容来源，可空" />
            </ElFormItem>
            <ElFormItem label="禅道任务">
              <ElInput v-model="app.artProgressDialog.form.zentaoTaskId" placeholder="禅道单号，可空" />
            </ElFormItem>
          </div>
          <ElFormItem label="摘要">
            <ElInput v-model="app.artProgressDialog.form.summary" type="textarea" :rows="6" placeholder="写清输入材料、输出结果、发现问题、适用边界和下一步" />
          </ElFormItem>
        </ElForm>
        <template #footer>
          <div class="dialog-footer-actions">
            <ElButton @click="app.closeArtProgressEventDialog">取消</ElButton>
            <ElButton v-if="app.canManageArtProgress" type="primary" :loading="app.loading.artProgressEvents" @click="app.saveArtProgressEventEdit">保存</ElButton>
          </div>
        </template>
      </ElDialog>
    </div>

    <div v-show="app.skillInventoryTab === 'list' || app.skillInventoryTab === 'assets'" class="skill-list-section">
    <ElTable
      class="skill-clean-table"
      :data="app.pagedSkillInventoryRows"
      row-key="uid"
      empty-text="暂无产物列表"
    >
      <ElTableColumn label="产物名称" min-width="520" fixed="left">
        <template #default="{ row }">
          <button type="button" class="skill-title-cell skill-title-button" @click="app.openSkillInventoryDetail(row)">
            <strong>{{ row.productDisplayName || row.productFileName || row.title || row.id }}</strong>
            <span>{{ app.skillSceneText(row, '待补充适用场景') }}</span>
          </button>
        </template>
      </ElTableColumn>
      <ElTableColumn label="版本" width="110">
        <template #default="{ row }">
          <span :class="['skill-version-pill', row.versionClass]">{{ row.version || row.skill?.version || '1.0' }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="贡献人" width="130">
        <template #default="{ row }">
          <span class="skill-table-text">{{ app.displayChinesePersonList(row.uploader) }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="调用次数" width="120">
        <template #default="{ row }">
          <div class="asset-usage-stack">
            <span class="skill-table-number">{{ row.usageCount || 0 }}</span>
            <small>验证 {{ row.validationCount || 0 }} / 研究 {{ row.researchSyncCount || 0 }}</small>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn label="有效占比" width="120">
        <template #default="{ row }">
          <span class="skill-table-number">{{ row.usageRate || 0 }}%</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="220" fixed="right" align="center">
        <template #default="{ row }">
          <div class="skill-action-links">
            <button v-if="app.canViewSkillUsageLogs" type="button" class="asset-action-button" @click="app.openSkillUsageDetail(row)">明细</button>
            <button v-if="app.canOperateSkillInventoryOwner" type="button" class="asset-action-button" @click="app.openSkillOwnerDialog(row)">归属</button>
            <button v-if="!row.hidden && app.canOperateSkillInventoryManage" type="button" class="asset-action-button danger" @click="app.deleteSkillInventoryRow(row)">隐藏</button>
            <button v-if="row.hidden && app.canOperateSkillInventoryManage" type="button" class="asset-action-button" @click="app.restoreSkillInventoryRow(row)">恢复</button>
            <button type="button" class="asset-action-button" @click="app.openSkillVersionHistory(row)">版本</button>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>
    <div class="pagination-bar">
      <span>共 {{ app.filteredSkillInventoryRows.length }} 条</span>
      <ElPagination
        :current-page="app.skillInventoryPage" @update:current-page="value => app.skillInventoryPage = value"
        :page-size="app.skillInventoryPageSize" @update:page-size="value => app.setWorkbenchPageSize(value, 'skillInventoryPage')"
        :page-sizes="[10, 50, 100]"
        :total="app.filteredSkillInventoryRows.length"
        page-size-label="条/页"
        layout="sizes, prev, pager, next"
      />
    </div>
    <section v-if="app.skillInventoryDocumentRows.length" class="skill-document-section">
      <div class="skill-member-summary-head">
        <div>
          <strong>文件说明 / 指引</strong>
          <span>未归入技能的项目文档、规范说明和参考资料。</span>
        </div>
      </div>
      <ElTable
        class="skill-clean-table"
        :data="app.skillInventoryDocumentRows"
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
              <ElButton type="primary" plain size="small" @click="app.openSkillPreview(row.skill)">查看内容</ElButton>
            </div>
          </template>
        </ElTableColumn>
      </ElTable>
    </section>
    </div>

    <div v-show="app.skillInventoryTab === 'events'" class="art-progress-section ai-asset-section">
      <div class="skill-member-summary-head">
        <div>
          <strong>人工研究清单</strong>
          <span>来自 Google 表第 {{ app.aiAssetSheetMeta?.startRow || 11 }} 行之后的记录，用于补充前期人工填写的研究、产物和复用信息。</span>
        </div>
        <div class="panel-actions art-progress-actions">
          <ElButton size="small" type="primary" plain @click="app.openAiAssetEdit()">新增研究记录</ElButton>
          <ElButton size="small" :loading="app.loading.aiAssetSheet" @click="app.refreshAiAssetSheet">刷新人工清单</ElButton>
          <ElButton size="small" type="primary" plain tag="a" :href="app.aiAssetSheetMeta?.sheetSourceUrl" target="_blank" rel="noopener noreferrer">打开原表</ElButton>
        </div>
      </div>
      <div class="art-progress-metrics">
        <article>
          <span>表格记录</span>
          <strong>{{ app.aiAssetSheetMeta?.total || app.aiAssetSheetRows.length }}</strong>
          <small>从第 11 行开始</small>
        </article>
        <article>
          <span>已公用</span>
          <strong>{{ app.aiAssetSheetMeta?.publicCount || 0 }}</strong>
          <small>是否公用为是</small>
        </article>
        <article>
          <span>已验证</span>
          <strong>{{ app.aiAssetSheetMeta?.verifiedCount || 0 }}</strong>
          <small>验证/准确度有结论</small>
        </article>
        <article>
          <span>Skill 路径</span>
          <strong>{{ app.aiAssetSheetMeta?.skillPathCount || 0 }}</strong>
          <small>有可沉淀路径</small>
        </article>
      </div>
      <div class="ai-asset-filter-bar">
        <ElInput
          v-model="app.aiAssetKeyword"
          clearable
          class="ai-asset-filter-input"
          placeholder="搜索研究内容、人员、路径"
          @update:model-value="app.aiAssetPage = 1"
        />
        <ElSelect
          v-model="app.aiAssetStatusFilter"
          clearable
          filterable
          class="ai-asset-status-select"
          placeholder="进度状态"
          @update:model-value="app.aiAssetPage = 1"
        >
          <ElOption v-for="status in app.aiAssetStatusOptions" :key="status" :label="status" :value="status" />
        </ElSelect>
        <ElPopover v-if="app.canManageSkillAssets" placement="bottom-end" trigger="click" width="280">
          <template #reference>
            <ElButton>字段显示</ElButton>
          </template>
          <div class="ai-asset-column-picker">
            <ElCheckbox
              v-for="column in app.aiAssetColumnOptions"
              :key="column.key"
              :model-value="app.isAiAssetColumnVisible(column.key)"
              :disabled="['title', 'usage', 'actions'].includes(column.key)"
              @update:model-value="checked => app.setAiAssetColumnVisible(column.key, checked)"
            >
              {{ column.label }}
            </ElCheckbox>
            <div class="skill-validation-column-picker-actions">
              <ElButton size="small" plain @click="app.syncAiAssetVisibleColumnsFromConfig">恢复已保存</ElButton>
              <ElButton size="small" type="primary" @click="app.saveAiAssetColumnConfig">保存字段</ElButton>
            </div>
          </div>
        </ElPopover>
        <ElButton
          :type="app.aiAssetShowHidden ? 'primary' : undefined"
          plain
          @click="app.toggleAiAssetHiddenView"
        >
          {{ app.aiAssetShowHidden ? '返回清单' : '查看已隐藏' }}
        </ElButton>
      </div>
      <ElAlert
        v-if="app.aiAssetSheetMeta?.lastError"
        type="warning"
        :closable="false"
        class="skill-validation-warning"
        :title="`实时读取失败，当前显示本地缓存：${app.aiAssetSheetMeta.lastError}`"
      />
      <ElTable
        class="skill-validation-table ai-asset-table"
        :data="app.pagedAiAssetRows"
        row-key="id"
        size="small"
        empty-text="暂无人工研究清单数据"
      >
        <ElTableColumn v-if="app.isAiAssetColumnVisible('rowNumber')" label="表格行" width="80">
          <template #default="{ row }">{{ row.rowNumber ? `#${row.rowNumber}` : '-' }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('title')" label="产物名称" min-width="240">
          <template #default="{ row }">
            <div class="skill-path-cell">
              <strong>{{ app.aiAssetDisplayFileName(row) || '-' }}</strong>
              <span v-if="row.suites">套系：{{ row.suites }}</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('owner')" label="贡献人" width="160">
          <template #default="{ row }">{{ app.displayPersonList(row.owner) }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('usage')" label="调用次数" width="110">
          <template #default="{ row }">
            <span class="archive-count-link static">{{ row.crossCount || 0 }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('progressStatus')" label="进度状态" width="180">
          <template #default="{ row }">
            <ElTag :type="app.aiAssetRowStatusType(row)" size="small">{{ row.progressStatus || '-' }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('dailyNote')" label="每日进展" min-width="220">
          <template #default="{ row }">{{ row.dailyNote || '-' }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('path')" label="产物目录 / 项目名" min-width="320">
          <template #default="{ row }">
            <div class="skill-path-cell ai-asset-path-cell">
              <span :title="row.finalPath || '-'">{{ row.finalPath || '-' }}</span>
              <button v-if="row.finalPath" type="button" class="copy-path-button" @click.stop="app.copyText(row.finalPath, '产物路径')">复制</button>
              <small>{{ row.projectName || '-' }}</small>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('validation')" label="验证信息" min-width="240">
          <template #default="{ row }">
            <div class="skill-path-cell">
              <span>{{ row.verifyStatus || '-' }}</span>
              <small v-if="row.availablePeople">可用：{{ row.availablePeople }}</small>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('publicStatus')" label="公用" width="100">
          <template #default="{ row }">
            <ElTag :type="/是|可/.test(row.publicStatus || '') ? 'success' : row.publicStatus ? 'info' : 'info'" size="small">{{ row.publicStatus || '-' }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('skillPath')" label="Skill 路径" min-width="260">
          <template #default="{ row }">
            <div class="skill-path-cell ai-asset-path-cell">
              <span :title="row.skillPath || '-'">{{ row.skillPath || '-' }}</span>
              <button v-if="row.skillPath" type="button" class="copy-path-button" @click.stop="app.copyText(row.skillPath, 'Skill 路径')">复制</button>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('fileLink')" label="文件链接" min-width="220">
          <template #default="{ row }">
            <div class="skill-path-cell ai-asset-path-cell">
              <span :title="row.fileLink || '-'">{{ row.fileLink || '-' }}</span>
              <button v-if="row.fileLink" type="button" class="copy-path-button" @click.stop="app.copyText(row.fileLink, '文件链接')">复制</button>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('source')" label="来源" width="130">
          <template #default="{ row }">
            <ElTag size="small" type="info">{{ row.source || '工作台' }}</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="app.isAiAssetColumnVisible('actions')" label="操作" width="260" fixed="right" align="center">
          <template #default="{ row }">
            <div class="table-action-row skill-validation-actions">
              <ElButton size="small" type="primary" plain @click="app.openAiAssetView(row)">明细</ElButton>
              <ElButton v-if="!row.deleted && app.canManageSkillAssets && app.canEditAiAsset(row)" size="small" type="primary" plain @click="app.openAiAssetEdit(row)">修改</ElButton>
              <ElButton v-if="!row.deleted && app.canManageSkillAssets && app.canEditAiAsset(row)" size="small" type="danger" plain @click="app.deleteAiAsset(row)">隐藏</ElButton>
              <ElButton v-if="row.deleted && app.canManageSkillAssets" size="small" type="primary" plain @click="app.restoreAiAsset(row)">恢复</ElButton>
            </div>
          </template>
        </ElTableColumn>
      </ElTable>
      <div class="pagination-bar ai-asset-pagination">
        <span>共 {{ app.filteredAiAssetRows.length }} 条</span>
        <ElPagination
          :current-page="app.aiAssetPage"
          @update:current-page="value => app.aiAssetPage = value"
          :page-size="app.aiAssetPageSize"
          @update:page-size="value => app.setWorkbenchPageSize(value, 'aiAssetPage')"
          :page-sizes="[10, 50, 100]"
          :total="app.filteredAiAssetRows.length"
          page-size-label="条/页"
          layout="sizes, prev, pager, next"
        />
      </div>
    </div>

    <ElDrawer
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
            <ElButton size="small" plain @click="app.resetSkillUsageFilter">重置筛选</ElButton>
          </div>
          <div class="skill-usage-metrics">
            <article v-for="metric in app.skillUsageDialog.metrics" :key="metric.label">
              <span>{{ metric.label }}</span>
              <strong>{{ metric.value }}</strong>
            </article>
          </div>
          <div class="skill-usage-filter-row">
            <span>时间范围</span>
            <div class="skill-usage-filters">
              <ElDatePicker
                v-model="app.skillUsageDialog.start"
                type="datetime"
                placeholder="开始时间"
                value-format="YYYY-MM-DD HH:mm:ss"
                @change="app.skillUsageDialog.page = 1"
              />
              <ElDatePicker
                v-model="app.skillUsageDialog.end"
                type="datetime"
                placeholder="结束时间"
                value-format="YYYY-MM-DD HH:mm:ss"
                @change="app.skillUsageDialog.page = 1"
              />
            </div>
          </div>
          <p>调用次数=所有命中使用明细条数；有效占比=扣除负责人和余盛威后的组员使用人数/目标人数；余盛威名下产物按单人累计 20 次封顶。</p>
        </div>
        <div class="art-progress-log-table skill-usage-log-table">
          <div class="art-progress-log-row skill-usage-log-row head">
            <span>时间</span>
            <span>类型</span>
            <span>成员</span>
            <span>产物</span>
            <span class="art-progress-log-summary-cell">摘要</span>
            <span class="art-progress-log-action-head">操作</span>
          </div>
          <div v-if="app.filteredSkillUsageLogs.length" class="art-progress-log-body">
            <div
              v-for="(item, index) in app.pagedSkillUsageLogs"
              :key="item.id || item.code || `${item.time}-${index}`"
              class="art-progress-log-row skill-usage-log-row"
            >
              <span>{{ app.formatDateSecond(item.time) || '-' }}</span>
              <span><ElTag size="small" type="info">{{ item.type || '使用记录' }}</ElTag></span>
              <span><strong>{{ item.person || '-' }}</strong></span>
              <span>
                <strong>{{ item.target || '-' }}</strong>
                <small>{{ item.task || '-' }}</small>
              </span>
              <span class="art-progress-log-summary-cell">
                <strong>{{ item.summary || '-' }}</strong>
                <small v-if="item.code">{{ item.code }}</small>
              </span>
              <span class="art-progress-log-actions">
                <ElButton size="small" type="primary" plain @click="app.openSkillUsageLogDetail(item)">查看内容</ElButton>
              </span>
            </div>
          </div>
          <div v-else class="art-progress-log-empty">暂无使用明细</div>
        </div>
        <div v-if="app.filteredSkillUsageLogs.length" class="pagination-bar art-progress-log-pagination">
          <span>共 {{ app.filteredSkillUsageLogs.length }} 条</span>
          <ElPagination
            :current-page="app.skillUsageDialog.page"
            @update:current-page="value => app.skillUsageDialog.page = value"
            :page-size="app.skillUsageDialog.pageSize"
            @update:page-size="value => { app.skillUsageDialog.pageSize = value; app.skillUsageDialog.page = 1; }"
            :page-sizes="[10, 50, 100]"
            :total="app.filteredSkillUsageLogs.length"
            page-size-label="条/页"
            layout="sizes, prev, pager, next"
          />
        </div>
      </div>
    </ElDrawer>

    <ElDialog v-model="app.skillOwnerDialog.visible" title="调整产物贡献人" width="420px" class="app-dialog" append-to-body align-center>
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

    <ElDialog v-model="app.skillHistoryDialog.visible" title="历史版本" width="760px" class="app-dialog skill-history-dialog" append-to-body>
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
  </ElCard>
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
    this.ensureValidationRows();
  },
  watch: {
    'app.activeView': 'ensureValidationRows',
    'app.skillInventoryTab': 'ensureValidationRows'
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
    ensureValidationRows() {
      if (this.app?.activeView !== 'skill-inventory') return;
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

  .skill-member-summary {
    display: grid;
    gap: 10px;
    margin-bottom: 16px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
    background:
      radial-gradient(circle at 98% 0%, color-mix(in srgb, var(--bg-b) 40%, transparent), transparent 28%),
      var(--panel);
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
    overflow: hidden;

    :deep(.el-table__cell) {
      font-size: 12px;
      padding: 9px 12px;
      vertical-align: middle;
    }

    :deep(.el-table__header th) {
      background: var(--table-header-bg);
      color: var(--muted);
      font-size: 12px;
      font-weight: 820;
    }

    :deep(.el-table__row) {
      height: 62px;
    }

    :deep(.el-table__cell) { border-bottom-color: var(--line); }
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
    gap: 8px 18px;
    justify-content: flex-start;
    line-height: 1.35;
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
    gap: 14px;
    min-height: 0;
  }

  .skill-usage-metrics {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .skill-usage-head {
    display: grid;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--soft-card) 72%, var(--panel) 28%), var(--panel));
  }

  .skill-usage-metrics article {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--card);
    display: grid;
    align-content: center;
    gap: 4px;
    min-height: 64px;
    padding: 10px 12px;
  }

  .skill-usage-metrics span,
  .skill-history-meta span {
    color: var(--muted);
    font-size: 12px;
    font-weight: 760;
  }

  .skill-usage-metrics strong {
    color: var(--primary);
    font-size: 20px;
    font-weight: 860;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }

  .skill-usage-title-row {
    align-items: center;
    display: flex;
    gap: 12px;
    justify-content: space-between;
    min-width: 0;
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
    font-size: 16px;
    font-weight: 860;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .skill-usage-head p {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    font-weight: 720;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .skill-usage-log-table {
    max-height: calc(100vh - 332px);
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
    .skill-usage-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .skill-usage-metrics,
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
  }

  .skill-version-pill.version-1 {
    background: rgba(100, 116, 139, 0.1);
    color: var(--text);
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
    display: inline-flex;
    flex-wrap: nowrap;
    gap: 5px;
    justify-content: center;
    width: 100%;
    white-space: nowrap;
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
