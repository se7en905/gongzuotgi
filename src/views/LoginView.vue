<template>
  <div class="login-shell" :data-theme="theme">
    <div class="login-panel">
      <h1>美术部工作台</h1>
      <p>登录后进入部门排期、AI 协作与 Skill 平台</p>
      <ElForm :model="model" label-position="top" @submit.prevent>
        <ElFormItem label="用户名">
          <ElInput v-model="model.username" autocomplete="username" placeholder="admin" @keyup.enter="$emit('submit')" />
        </ElFormItem>
        <ElFormItem label="密码">
          <ElInput v-model="model.password" type="password" autocomplete="current-password" show-password placeholder="请输入密码" @keyup.enter="$emit('submit')" />
        </ElFormItem>
        <ElAlert v-if="error" class="login-error" type="error" :closable="false" :title="error" />
        <ElButton type="primary" class="full-button" :loading="loading" @click="$emit('submit')">登录</ElButton>
      </ElForm>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LoginView',
  props: {
    model: {
      type: Object,
      required: true
    },
    error: {
      type: String,
      default: ''
    },
    loading: {
      type: Boolean,
      default: false
    },
    theme: {
      type: String,
      default: 'light'
    }
  },
  emits: ['submit']
};
</script>
