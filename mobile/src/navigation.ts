export type RootStackParamList = {
  Login: undefined
  Projects: undefined
  Plans: { projectId: string; projectName: string }
  Plan: { projectId: string; planId: string; planName: string }
  Submission: { pinId: string; templateId?: string }
  Tasks: { projectId: string; mine?: boolean }
  TaskDetail: { taskId: string }
  SyncIssues: undefined
}
