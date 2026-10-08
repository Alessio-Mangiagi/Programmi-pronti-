import type { components } from './schema'

// Alias comodi sui tipi generati: un solo punto da aggiornare se cambiano i nomi.
export type User = components['schemas']['UserOut']
export type Project = components['schemas']['ProjectOut']
export type Plan = components['schemas']['PlanOut']
export type FormTemplate = components['schemas']['FormTemplateOut']
export type Task = components['schemas']['TaskOut']
export type Submission = components['schemas']['SubmissionOut']
export type Attachment = components['schemas']['AttachmentOut']
export type PinDetail = components['schemas']['PinDetail']
export type PinSummary = components['schemas']['PinSummary']
export type WbsNode = components['schemas']['WbsNodeOut']
export type WbsNodeDetail = components['schemas']['WbsNodeDetail']
export type WbsImportResult = components['schemas']['WbsImportResult']
export type PcqPreview = components['schemas']['PcqPreview']
export type ProjectSubmission = components['schemas']['ProjectSubmissionOut']
export type InviteLabel = components['schemas']['InviteLabelOut']
export type Invite = components['schemas']['InviteOut']
export type InvitePreview = components['schemas']['InvitePreviewOut']
export type SupportMessage = components['schemas']['SupportMessageOut']
export type TaskStatus = 'open' | 'assigned' | 'resolved' | 'verified'

// Schema dei moduli: i tipi vivono in packages/form-core (condivisi con il mobile).
export type { FormSchema, FormData, FieldError } from '@fieldview/form-core'
