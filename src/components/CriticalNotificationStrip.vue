<template>
  <section v-if="hasAlerts" class="critical-strip critical-strip-inline">
    <button class="critical-strip-main" type="button" @click="goMetric(primaryMetric)">
      <strong>{{ headline }}</strong>
      <span>{{ subline }}</span>
    </button>
    <div class="critical-strip-counts">
      <button v-for="metric in displayMetrics" :key="metric.key" type="button" @click="goMetric(metric.metric)">
        <small>{{ metric.label }}</small>
        <b>{{ metric.value }}</b>
      </button>
    </div>
  </section>
</template>

<script>
export default {
  name: 'CriticalNotificationStrip',
  props: {
    app: {
      type: Object,
      required: true
    },
    metrics: {
      type: Array,
      default: () => []
    },
    canViewTasks: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    metricMap() {
      return new Map(this.metrics.map(metric => [metric.filter, metric.value]));
    },
    taskRows() {
      return Array.isArray(this.app.taskCenterCurrentBusinessTaskRows) ? this.app.taskCenterCurrentBusinessTaskRows : [];
    },
    bugRows() {
      return Array.isArray(this.app.taskCenterBugRows) ? this.app.taskCenterBugRows : [];
    },
    todayDueTasks() {
      const today = this.todayKey();
      return this.taskRows.filter(task => task.deadline === today && !this.isClosedTask(task));
    },
    riskTasks() {
      return this.taskRows.filter(task => this.app.isArtTaskRisk(task));
    },
    activeBugs() {
      return this.bugRows.filter(bug => !this.isClosedBug(bug));
    },
    urgentBugs() {
      return this.bugRows.filter(bug => !this.isClosedBug(bug) && (Number(bug.pri || 0) <= 2 || Number(bug.severity || 0) <= 2));
    },
    summary() {
      const dueToday = this.numberMetric(this.metricMap.get('todayDue'), this.todayDueTasks.length);
      const riskTasks = this.numberMetric(this.metricMap.get('riskTask'), this.riskTasks.length);
      const activeBugs = this.numberMetric(this.metricMap.get('webBug'), this.activeBugs.length);
      const urgentBugs = this.numberMetric(this.metricMap.get('urgentBug'), this.urgentBugs.length);
      return {
        dueToday,
        riskTasks,
        activeBugs,
        urgentBugs,
        total: dueToday + riskTasks + activeBugs
      };
    },
    displayMetrics() {
      return [
        { key: 'dueToday', label: '今日截止', value: this.summary.dueToday, metric: 'todayDue' },
        { key: 'riskTasks', label: '卡点任务', value: this.summary.riskTasks, metric: 'riskTask' },
        { key: 'activeBugs', label: '待处理 Bug', value: this.summary.activeBugs, metric: 'webBug' },
        { key: 'urgentBugs', label: '高优 Bug', value: this.summary.urgentBugs, metric: 'urgentBug' }
      ];
    },
    headline() {
      if (this.summary.dueToday) return `今天有 ${this.summary.dueToday} 个禅道单截止`;
      if (this.summary.riskTasks) return `还有 ${this.summary.riskTasks} 个任务需要关注`;
      return `当前有 ${this.summary.activeBugs} 个 Bug 待处理`;
    },
    subline() {
      return `卡点任务 ${this.summary.riskTasks}，待处理 Bug ${this.summary.activeBugs}，高优 Bug ${this.summary.urgentBugs}`;
    },
    primaryMetric() {
      if (this.summary.dueToday) return 'todayDue';
      if (this.summary.riskTasks) return 'riskTask';
      return 'webBug';
    },
    hasAlerts() {
      return this.canViewTasks && this.summary.total > 0;
    }
  },
  methods: {
    todayKey() {
      const date = new Date();
      const year = date.getFullYear();
      const month = `${date.getMonth() + 1}`.padStart(2, '0');
      const day = `${date.getDate()}`.padStart(2, '0');
      return `${year}-${month}-${day}`;
    },
    numberMetric(value, fallback = 0) {
      if (value === null || value === undefined || value === '') return fallback;
      const number = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
      return Number.isFinite(number) ? number : 0;
    },
    isClosedTask(task) {
      return /closed|cancel|cancelled/i.test(task.zentaoStatus || task.zentao?.originalStatus || task.status || '');
    },
    isClosedBug(bug) {
      return /closed|resolved/i.test(bug.status || bug.zentao?.status || '');
    },
    goMetric(metric) {
      this.app.applyTaskMetricFilter(metric);
      this.app.switchView('tasks');
    }
  }
};
</script>
