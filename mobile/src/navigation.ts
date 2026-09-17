export type RootStackParamList = {
  Login: undefined
  Projects: undefined
  Plans: { projectId: string; projectName: string }
  Plan: { projectId: string; planId: string; planName: string }
  SyncIssues: undefined
}
