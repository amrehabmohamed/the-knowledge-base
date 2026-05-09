import { Type, type FunctionDeclaration } from "@google/genai";

export const CRM_LIST_STAGES_DECL: FunctionDeclaration = {
  name: "crm_list_stages",
  description:
    "Lists all CRM pipeline stages for the connected user. Returns id, name, slug, " +
    "stageType ('entry'/'working'/'terminal_won'/'terminal_lost'), sortOrder, color, " +
    "mandatoryFields (fields required to ENTER this stage), and allowedNextStages " +
    "(which stage IDs can be reached from each). ALWAYS call this before " +
    "crm_transition_stage to look up the target stageId by name and check what " +
    "fields the destination stage requires.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

export const CRM_LIST_LEADS_DECL: FunctionDeclaration = {
  name: "crm_list_leads",
  description:
    "List/search leads. Returns paginated lead summaries. Use stageId from " +
    "crm_list_stages to filter by pipeline stage. Examples: " +
    "{ stageId: '6650...', limit: 20 } or { search: 'Ahmed', assignedToMe: true } or " +
    "{ search: '+201001234567' }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      stageId: { type: Type.STRING, description: "Filter by stage ID (from crm_list_stages)." },
      assignedToMe: {
        type: Type.BOOLEAN,
        description: "If true, only show leads assigned to the current user.",
      },
      search: {
        type: Type.STRING,
        description: "Free-text fuzzy match against name, phone, and email.",
      },
      page: { type: Type.NUMBER, description: "1-based page number. Default 1." },
      limit: { type: Type.NUMBER, description: "Page size. Default 20, max 100." },
    },
  },
};

export const CRM_GET_LEAD_DECL: FunctionDeclaration = {
  name: "crm_get_lead",
  description:
    "Get full details of a single lead by ID, including custom fields and current " +
    "stage. Useful before update or transition to confirm current state.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      leadId: { type: Type.STRING, description: "The lead's ID." },
    },
    required: ["leadId"],
  },
};

export const CRM_CREATE_LEAD_DECL: FunctionDeclaration = {
  name: "crm_create_lead",
  description:
    "Create a new lead. ALL FOUR of firstName, lastName, phone, and email are " +
    "required by the backend — if the user hasn't given an email or a phone, ask " +
    "for it explicitly before invoking this tool. Will request user approval " +
    "before executing. Example: " +
    "{ firstName: 'Ahmed', lastName: 'Hassan', phone: '+201001234567', email: 'ahmed@example.com', source: 'whatsapp', priority: 'high' }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      firstName: { type: Type.STRING },
      lastName: { type: Type.STRING },
      phone: {
        type: Type.STRING,
        description: "International format, e.g. +201001234567. Required.",
      },
      email: { type: Type.STRING, description: "Required." },
      source: {
        type: Type.STRING,
        description:
          "Channel slug: 'walk_in' | 'phone' | 'website' | 'whatsapp' | 'facebook' | " +
          "'instagram' | 'referral' | 'other'.",
      },
      priority: { type: Type.STRING, description: "'low' | 'high'." },
      assignedToUserId: {
        type: Type.STRING,
        description: "User ID to assign the lead to.",
      },
    },
    required: ["firstName", "lastName", "phone", "email"],
  },
};

export const CRM_UPDATE_LEAD_DECL: FunctionDeclaration = {
  name: "crm_update_lead",
  description:
    "Update an existing lead's fields. fields can include core fields (firstName, " +
    "lastName, email, phone, priority, assignedToUserId) AND any custom fields " +
    "defined for this tenant. Will request user approval. Example: " +
    "{ leadId: '6650...', fields: { priority: 'high', preferredBranch: 'Cairo' } }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      leadId: { type: Type.STRING },
      fields: {
        type: Type.OBJECT,
        description:
          "Flat key/value updates. Custom fields are routed automatically. Pass " +
          "scalar values (string/number/boolean/date string).",
      },
    },
    required: ["leadId", "fields"],
  },
};

export const CRM_TRANSITION_STAGE_DECL: FunctionDeclaration = {
  name: "crm_transition_stage",
  description:
    "Move a lead to a new stage. CRITICAL: read crm_list_stages first to (a) get " +
    "the target stageId and (b) check mandatoryFields. If the lead is missing any " +
    "mandatoryFields for the target stage, pass them in fieldUpdates so they're " +
    "set atomically with the transition. The connector validates locally before " +
    "requesting approval — if anything is missing it will respond with " +
    "status='validation_pending' and a list of missing fields, so you can ask the " +
    "user. Will request user approval. Example: " +
    "{ leadId: '6650...', toStageId: '6651...', fieldUpdates: { bookingDate: '2026-05-20' }, reason: 'Customer ready to book' }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      leadId: { type: Type.STRING },
      toStageId: {
        type: Type.STRING,
        description: "Target stageId. Must be a valid stageId from crm_list_stages.",
      },
      fieldUpdates: {
        type: Type.OBJECT,
        description:
          "Optional fields to set on the lead atomically with the transition. " +
          "Use this when the target stage has mandatoryFields not yet filled.",
      },
      reason: { type: Type.STRING, description: "Optional human-readable reason." },
    },
    required: ["leadId", "toStageId"],
  },
};

// ─── Pipeline stage management ─────────────────────────────────────────────

export const CRM_CREATE_STAGE_DECL: FunctionDeclaration = {
  name: "crm_create_stage",
  description:
    "Create a new pipeline stage. Required: name and sortOrder (integer position). " +
    "Optional: color (hex like '#3B82F6'), mandatoryFields (array of customField IDs " +
    "the lead must have set before entering this stage — call crm_list_custom_fields " +
    "first to look up IDs by label). Will request user approval. Example: " +
    "{ name: 'Negotiation', sortOrder: 4, color: '#F59E0B' }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "Stage display name. Required." },
      sortOrder: {
        type: Type.NUMBER,
        description: "Integer position in the pipeline. Required.",
      },
      color: {
        type: Type.STRING,
        description: "Hex color e.g. '#3B82F6' or '#F0F'.",
      },
      mandatoryFields: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "CustomField IDs that must be filled before a lead can enter this stage.",
      },
    },
    required: ["name", "sortOrder"],
  },
};

export const CRM_UPDATE_STAGE_DECL: FunctionDeclaration = {
  name: "crm_update_stage",
  description:
    "Update an existing pipeline stage. At least one of name, color, or mandatoryFields " +
    "must be provided. Will request user approval. Example: " +
    "{ stageId: '6650...', color: '#10B981', mandatoryFields: ['66a...', '66b...'] }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      stageId: { type: Type.STRING, description: "Stage ID to update." },
      name: { type: Type.STRING },
      color: { type: Type.STRING, description: "Hex color." },
      mandatoryFields: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Replaces the full list of mandatoryField IDs.",
      },
    },
    required: ["stageId"],
  },
};

export const CRM_DELETE_STAGE_DECL: FunctionDeclaration = {
  name: "crm_delete_stage",
  description:
    "Delete a pipeline stage. If the stage has open leads, reassignToStageId is " +
    "required so those leads aren't orphaned. Cannot delete entry/terminal stages. " +
    "Will request user approval. Example: " +
    "{ stageId: '6650...', reassignToStageId: '6651...' }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      stageId: { type: Type.STRING },
      reassignToStageId: {
        type: Type.STRING,
        description:
          "Stage to move open leads into. Required if any leads are in the deleted stage.",
      },
    },
    required: ["stageId"],
  },
};

// ─── Custom field management ───────────────────────────────────────────────

export const CRM_LIST_CUSTOM_FIELDS_DECL: FunctionDeclaration = {
  name: "crm_list_custom_fields",
  description:
    "List all custom fields defined for this tenant. Returns id, fieldName, label, " +
    "fieldType ('text'|'text_area'|'number'|'date'|'single_select'|'multi_select'|'boolean'), " +
    "options (for selects), location ('customer_profile'|'appointment'|'consultation'), " +
    "module ('crm'|'platform'|'cms'), isMandatory, requiredAtCreation. ALWAYS call " +
    "this before crm_create_stage / crm_update_stage when setting mandatoryFields, and " +
    "before crm_update_custom_field / crm_delete_custom_field to find the right field ID.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      location: {
        type: Type.STRING,
        description:
          "Filter by location: 'customer_profile' | 'appointment' | 'consultation'.",
      },
      isActive: {
        type: Type.BOOLEAN,
        description: "If true, only active fields. Defaults to true.",
      },
    },
  },
};

export const CRM_CREATE_CUSTOM_FIELD_DECL: FunctionDeclaration = {
  name: "crm_create_custom_field",
  description:
    "Create a new custom field. Required: fieldName (snake_case, e.g. 'preferred_branch'), " +
    "label (human-readable, e.g. 'Preferred Branch'), fieldType, location. For " +
    "single_select / multi_select fieldType, options[] is required. Will request " +
    "user approval. Example: " +
    "{ fieldName: 'preferred_branch', label: 'Preferred Branch', fieldType: 'single_select', " +
    "location: 'customer_profile', options: ['Cairo', 'Alex', 'Giza'] }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      fieldName: {
        type: Type.STRING,
        description: "Stable machine name, snake_case. Required.",
      },
      label: { type: Type.STRING, description: "Display label. Required." },
      fieldType: {
        type: Type.STRING,
        description:
          "'text' | 'text_area' | 'number' | 'date' | 'single_select' | 'multi_select' | 'boolean'.",
      },
      location: {
        type: Type.STRING,
        description: "'customer_profile' | 'appointment' | 'consultation'.",
      },
      module: {
        type: Type.STRING,
        description: "'crm' | 'platform' | 'cms'. Defaults to 'crm'.",
      },
      options: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Required for single_select / multi_select.",
      },
      isMandatory: { type: Type.BOOLEAN },
      requiredAtCreation: {
        type: Type.BOOLEAN,
        description: "If true, lead create requires this field.",
      },
    },
    required: ["fieldName", "label", "fieldType", "location"],
  },
};

export const CRM_UPDATE_CUSTOM_FIELD_DECL: FunctionDeclaration = {
  name: "crm_update_custom_field",
  description:
    "Update an existing custom field's label, options, isMandatory, requiredAtCreation, " +
    "or isActive. fieldName and fieldType are immutable once created. Will request " +
    "user approval. Example: " +
    "{ fieldId: '6650...', label: 'Preferred Clinic', options: ['Cairo','Alex','Giza','Mansoura'] }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      fieldId: { type: Type.STRING },
      label: { type: Type.STRING },
      options: { type: Type.ARRAY, items: { type: Type.STRING } },
      isMandatory: { type: Type.BOOLEAN },
      requiredAtCreation: { type: Type.BOOLEAN },
      isActive: { type: Type.BOOLEAN },
    },
    required: ["fieldId"],
  },
};

export const CRM_DELETE_CUSTOM_FIELD_DECL: FunctionDeclaration = {
  name: "crm_delete_custom_field",
  description:
    "Delete a custom field. Backend rejects if the field is locked or in use by a " +
    "stage's mandatoryFields. Will request user approval.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      fieldId: { type: Type.STRING },
    },
    required: ["fieldId"],
  },
};

export const CRM_LIST_USERS_DECL: FunctionDeclaration = {
  name: "crm_list_users",
  description:
    "List all users on the CRM workspace who can own/be-assigned a lead — " +
    "managers, team leads, and unassigned-pool members. Each entry has " +
    "{ id, name, email, role, isMe }. **Always call this BEFORE crm_assign_lead** " +
    "when the user names a person ('assign to Sara', 'reassign to me', " +
    "'give it to John'). For 'me'/'myself'/'I', look for the entry with " +
    "isMe: true — that's the connected user. For a name, match case-insensitively " +
    "on name and email. If multiple users match (e.g. two Saras), ask the user " +
    "which one they meant before assigning.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      search: {
        type: Type.STRING,
        description:
          "Optional case-insensitive substring filter on name/email. Server-side " +
          "filtering not guaranteed — if backend ignores it we filter locally.",
      },
    },
  },
};

export const CRM_ASSIGN_LEAD_DECL: FunctionDeclaration = {
  name: "crm_assign_lead",
  description:
    "Assign a lead to a specific team member by user ID. CALL crm_list_users " +
    "FIRST to resolve a name (or 'me') to the right userId. The shortcut " +
    "`assigneeUserId: 'me'` is also accepted and resolves to the connected user " +
    "automatically. Will request user approval.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      leadId: { type: Type.STRING },
      assigneeUserId: { type: Type.STRING, description: "User ID of the assignee." },
    },
    required: ["leadId", "assigneeUserId"],
  },
};
