import { ButtonText, Checkbox, ContainerContext, DialogContext, Dismiss, FieldSize, HumanAvatar, Menu, MenuAction, MenuActionButtonProps, MenuArrowIcon, MenuItem, MenuSize, Modal, ModalSizes, PrimaryButton, Rosetta, Search, SecondaryButton, Size, StandaloneAvatarSizes, SubduedSimpleIconButton, ToastStatus, useDialog } from "@joinhandshake/rosetta";
import "./styles.scss";
import * as React from "react";
import { useNamespacedTranslation } from "@joinhandshake/i18n";
import { AttachableTypeEnum, graphql, ShareWindowGetMentionRecommendationsDocument, User, ShareWindow_UserFragment, ShareWindow_JobFragment, ShareWindowInboxConversationSendMessageMutationDocument, ShareableObjectTypeEnum, Job } from "@joinhandshake/consumer-graphql-types";
import { useMutation, useQuery } from "@apollo/client";
import { RichTextEditor, RTEToolbar, ToolbarItem, ToolbarItemPosition } from "@joinhandshake/keystone";
import { uniqueId } from "lodash-es";
import { EventType } from "@joinhandshake/tracking/schemaflow/tracking_base/common/v1/event_type_pb";
import { JobShareMessageStart } from "@joinhandshake/tracking/schemaflow/tracking_universal/jobs/v1/job_share_message_start_pb";
import { JobShareMessageSend } from "@joinhandshake/tracking/schemaflow/tracking_universal/jobs/v1/job_share_message_send_pb";
import { JobCopyLinkClick } from "@joinhandshake/tracking/schemaflow/tracking_universal/jobs/v1/job_copy_link_click_pb";
import { JobShareLinkClick } from "@joinhandshake/tracking/schemaflow/tracking_universal/jobs/v1/job_share_link_click_pb";
import { segment } from "@frontend/utils";
import { addToast } from "@joinhandshake/garr-shared";
import { useCreateConsumerJobEvent } from "../../hooks/useConsumerTrackingData";
import { useConsumerFeatureFlagToggle } from "../../hooks/useConsumerFeatureFlagToggle";
import { dictionaries } from "./locales";
graphql(/* GraphQL */`
  fragment ShareWindow_User on User {
    id
    name
    lastName
    isStudent
    calculatedFirstName
    userProfilePhotoUrl
    primaryEducation {
      id
      schoolName
      classYear
      majors {
        id
        name
      }
      minors {
        id
        name
      }
    }
    workExperiences {
      id
      employerName
      jobPositionName
    }
    educations {
      id
      schoolName
      classYear
      majors {
        id
        name
      }
      minors {
        id
        name
      }
    }
  }
`);
graphql(/* GraphQL */`
  query ShareWindowGetMentionRecommendations($searchQuery: String!) {
    mentionRecommendations(searchQuery: $searchQuery) {
      peopleSuggestions {
        ...ShareWindow_User
      }
    }
  }
`);
graphql(/* GraphQL */`
  mutation ShareWindowInboxConversationSendMessageMutation(
    $input: ShareContentInput!
  ) {
    shareContent(input: $input) {
      result {
        errors {
          code
          message
        }
        success
        bulkMessageId
      }
    }
  }
`);
graphql(/* GraphQL */`
  fragment ShareWindow_Job on Job {
    id
  }
`);

// These fragments will be used in future implementations
// Using variables to prevent unused fragment errors
// const ShareWindow_EventFragment = graphql(/* GraphQL */ `
//   fragment ShareWindow_Event on Event {
//     id
//   }
// `);

// const ShareWindow_CareerCenterFragment = graphql(/* GraphQL */ `
//   fragment ShareWindow_CareerCenter on CareerCenter {
//     id
//   }
// `);

// const ShareWindow_ContentPostFragment = graphql(/* GraphQL */ `
//   fragment ShareWindow_ContentPost on ContentPost {
//     id
//   }
// `);

const MemoAvatar = React.memo(({
  user
}: {
  user: ShareWindow_UserFragment;
}) => <HumanAvatar containerContext={ContainerContext.Standalone} size={StandaloneAvatarSizes.Small} text={`${user.calculatedFirstName} ${user.lastName}`}>
      <img src={user.userProfilePhotoUrl || ""} alt={`${user.calculatedFirstName} ${user.lastName}`} />
    </HumanAvatar>);
const MenuDisclosure = ({
  visible,
  ...rest
}: MenuActionButtonProps) => {
  const {
    t
  } = useNamespacedTranslation(__filename, dictionaries);
  return <MenuAction {...rest} visible={visible} forwardedAs={SecondaryButton} style={{
    gap: "var(--rosetta-size-spacing-two)"
  }}>
      {t("share")}
      <MenuArrowIcon visible={!!visible} data-size={MenuSize.Medium} />
    </MenuAction>;
};
const PeopleListItemSubtitle = ({
  user
}: {
  user: ShareWindow_UserFragment;
}) => {
  // Show education subtitle if user has at least one education, and workExperiences is an array (even if empty)
  if (user?.educations?.length > 0 && Array.isArray(user.workExperiences) && user.workExperiences.length === 0) {
    const majorName = user.educations[0]?.majors && user.educations[0]?.majors[0]?.name;
    return <p className="PersonSubtext">
        {majorName}
        {majorName && user.educations[0].classYear && " · "}
        {user.educations[0].classYear}
      </p>;
  }

  // Show work experience subtitle if user has at least one work experience
  if (Array.isArray(user.workExperiences) && user.workExperiences.length > 0) {
    const {
      employerName,
      jobPositionName
    } = user.workExperiences[0];
    return <p className="PersonSubtext">
        {employerName}
        {employerName && jobPositionName && " · "}
        {jobPositionName}
      </p>;
  }

  // No subtitle
  return null;
};
const PeopleListItem = ({
  user,
  isChecked,
  setSelectedUserIds,
  selectedUserIds
}: {
  user: ShareWindow_UserFragment;
  isChecked: boolean;
  setSelectedUserIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedUserIds: string[];
}) => {
  // Only uncenter username if a subtitle will actually render
  const hasEducationForSubtitle = user?.educations?.length > 0 && Array.isArray(user.workExperiences) && user.workExperiences.length === 0;
  const hasWorkExperienceForSubtitle = Array.isArray(user.workExperiences) && user.workExperiences.length > 0;
  const subtitleWillRender = hasEducationForSubtitle || hasWorkExperienceForSubtitle;
  return <li data-hook={`user-item-${user.id}`}>
      <Checkbox checked={isChecked} role="checkbox" aria-label={`Select ${user?.calculatedFirstName} ${user?.lastName}`} disabled={selectedUserIds.length >= 25 && !isChecked} onChange={e => {
      if (e.target.checked) {
        setSelectedUserIds(prev => [...prev, user.id]);
      } else {
        setSelectedUserIds(prev => prev.filter(id => id !== user.id));
      }
    }} />
      <MemoAvatar user={user as User} />
      <div data-testid="detailsContainer" centered={!subtitleWillRender} className="DetailsContainer">
        <p className="Username">{`${user?.calculatedFirstName} ${user?.lastName}`}</p>
        {subtitleWillRender && <PeopleListItemSubtitle user={user} />}
      </div>
    </li>;
};
interface ShareWindowProps {
  obj: ShareWindow_JobFragment;
  // | ShareWindow_EventFragment
  // | ShareWindow_CareerCenterFragment;
  // | ShareWindow_ContentPostFragment;
  type: AttachableTypeEnum;
  trackingProperties?: {
    jobIsPromoted?: boolean;
    shouldPromoteJob?: boolean;
    searchId?: string | null;
  };
}
const ShareWindow = ({
  type,
  obj,
  trackingProperties = {}
}: ShareWindowProps) => {
  const modal = useDialog();
  const {
    t
  } = useNamespacedTranslation(__filename, dictionaries);
  const isPublicJobsEnabled = useConsumerFeatureFlagToggle("gg-cxp-public-job-page");
  const [selectedUserIds, setSelectedUserIds] = React.useState<string[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [editorValue, setEditorValue] = React.useState(t(`${type.toLowerCase()}.defaultMessage`));
  const [allLoadedUsers, setAllLoadedUsers] = React.useState<ShareWindow_UserFragment[]>([]);
  const [displayedSelectedIds, setDisplayedSelectedIds] = React.useState<string[]>([]);
  const {
    data: peopleSuggestions,
    loading: peopleSuggestionsLoading,
    error: peopleSuggestionsError
  } = useQuery(ShareWindowGetMentionRecommendationsDocument, {
    skip: !modal.visible,
    variables: {
      searchQuery
    },
    onCompleted: data => {
      const newUsers = data?.mentionRecommendations?.peopleSuggestions || [];
      setAllLoadedUsers(prev => {
        const existingIds = new Set(prev.map(u => u.id));
        const merged = [...prev];
        newUsers.forEach(u => {
          if (!existingIds.has(u.id)) merged.push(u as User);
        });
        return merged;
      });
    }
  });
  const {
    jobIsPromoted,
    shouldPromoteJob,
    searchId
  } = trackingProperties || {};
  const baseTrackingData = {
    job: obj as Job,
    promotionData: {
      isPromoted: !!jobIsPromoted,
      shouldPromote: !!shouldPromoteJob
    },
    searchData: {
      jsaasSearchId: searchId ?? undefined
    }
  };
  const jobShareMessageStart = useCreateConsumerJobEvent(JobShareMessageStart, baseTrackingData, EventType.CLICK);

  // Create the event function at component level, not inside callback
  const jobShareMessageSent = useCreateConsumerJobEvent(JobShareMessageSend, baseTrackingData, EventType.CLICK);
  const jobCopyLinkClick = useCreateConsumerJobEvent(JobCopyLinkClick, baseTrackingData, EventType.CLICK);
  const jobShareLinkClick = useCreateConsumerJobEvent(JobShareLinkClick, baseTrackingData, EventType.CLICK);
  const [shareContent, {
    loading: isSharing
  }] = useMutation(ShareWindowInboxConversationSendMessageMutationDocument, {
    onCompleted: data => {
      // Check if the operation was successful before closing modal
      if (data?.shareContent?.result?.success === true && !data?.shareContent?.result?.errors?.length) {
        // Use the pre-created event function with updated data
        const shareJobSubmit = {
          ...jobShareMessageSent,
          bulk_message_id: data?.shareContent?.result?.bulkMessageId
        };
        segment.trackEvent("job_share_message_send", shareJobSubmit);
        modal.hide();
        setSelectedUserIds([]);
        setSearchQuery("");
        setDisplayedSelectedIds([]);
        setEditorValue(t([`${type.toLowerCase()}.defaultMessage`, "genericMessage"]));
      }
    }
  });
  const convertObjectTypeValue = (attachmentType: AttachableTypeEnum): ShareableObjectTypeEnum => {
    switch (attachmentType) {
      case AttachableTypeEnum.Job:
        return ShareableObjectTypeEnum.Job;
      // case AttachableTypeEnum.Event:
      //   return ShareableObjectTypeEnum.Event;
      // case AttachableTypeEnum.CareerCenter:
      //   return ShareableObjectTypeEnum.CareerCenter;
      default:
        throw new Error(`Unsupported shareable object type: ${attachmentType}`);
    }
  };
  const handleShare = async () => {
    if (selectedUserIds.length === 0 || !editorValue.trim()) {
      return;
    }
    const response = await shareContent({
      variables: {
        input: {
          objectId: obj.id,
          objectType: convertObjectTypeValue(type),
          recipientIds: selectedUserIds,
          message: editorValue,
          source: "job_details"
        }
      }
    });
    if (response.data?.shareContent?.result?.success !== true || response.data?.shareContent?.result?.errors?.length) {
      addToast({
        id: `share${convertObjectTypeValue(type)}-${uniqueId()}`,
        title: t("messageNotSent"),
        message: response?.data?.shareContent?.result?.errors?.map(e => t(`errorMessage.${e.code.toLowerCase()}`)).join(", ") || t("errorMessage.generic"),
        status: ToastStatus.Negative,
        icon: "roadSignBanned"
      });
    } else {
      addToast({
        id: `share${convertObjectTypeValue(type)}-${uniqueId()}`,
        title: t("messageSent"),
        unsafeHtml: `<a href="/inbox">${t("messageSentLinkText")}</a>`,
        status: ToastStatus.Positive,
        icon: "checkCircle"
      });
    }
  };
  const handleNativeShare = async () => {
    const jobUrl = `${window.location.origin}/public/jobs/${obj.id}?utm_source=web&utm_campaign=job_share&utm_medium=share&utm_content=stu-share-job_page`;
    const shareData = {
      title: t(`job.title`),
      text: t(`job.defaultMessage`),
      url: jobUrl
    };
    segment.trackEvent("job_share_link_click", jobShareLinkClick);
    await navigator.share(shareData);
  };
  const handleCopyLink = async () => {
    try {
      const jobUrl = `${window.location.origin}/public/jobs/${obj.id}?utm_source=web&utm_campaign=job_share&utm_medium=copy_link&utm_content=stu-copy_link-job_page`;
      segment.trackEvent("job_copy_link_click", jobCopyLinkClick);
      await navigator.clipboard.writeText(jobUrl);
      addToast({
        id: `copy-link-success-${uniqueId()}`,
        title: t("linkCopied"),
        message: t("linkCopiedMessage"),
        status: ToastStatus.Positive,
        icon: "checkCircle"
      });
    } catch (error) {
      addToast({
        id: `copy-link-error-${uniqueId()}`,
        title: t("copyLinkFailed"),
        message: t("copyLinkFailedMessage"),
        status: ToastStatus.Information,
        icon: "info"
      });
    }
  };
  return <DialogContext.Provider value={modal}>
      {isPublicJobsEnabled && <Menu data-size={MenuSize.Medium} disclosure={MenuDisclosure}>
          <MenuItem onClick={handleCopyLink}>
            <div className="MenuItemContent">
              <Rosetta.Hyperlink width="24px" height="24px" />
              <span>{t("copyLink")}</span>
            </div>
          </MenuItem>
          {!!navigator.share &&
      // show native sharing option if supported by browser
      <MenuItem onClick={handleNativeShare}>
              <div className="MenuItemContent">
                <Rosetta.Share width="24px" height="24px" />
                <span>{t("shareTo")}</span>
              </div>
            </MenuItem>}
          <MenuItem onClick={() => {
        modal.show();
        segment.trackEvent("job_share_message_start", jobShareMessageStart);
      }}>
            <div className="MenuItemContent">
              <Rosetta.SendEmail width="24px" height="24px" />
              <span>{t("sendJobTo")}</span>
            </div>
          </MenuItem>
        </Menu>}
      <Modal size={ModalSizes.Narrow} disclosure={isPublicJobsEnabled ? undefined : <SecondaryButton {...modal} aria-label={t("shareButtonLabel")} onClick={() => {
      segment.trackEvent("job_share_message_start", jobShareMessageStart);
    }}>
              <Rosetta.SendEmail />
              <span className="ShareLabel">{t("share")}</span>
            </SecondaryButton>} visible={isPublicJobsEnabled ? modal.visible : undefined} hide={isPublicJobsEnabled ? modal.hide : undefined} className="StyledModal">
        <div className="Header">
          <h1 className="Title">{t([`${type.toLowerCase()}.title`, "genericTitle"])}</h1>
          <Dismiss>
            <SubduedSimpleIconButton aria-label={t("closeModal")} size={Size.medium} onClick={() => {
            setSelectedUserIds([]);
            setSearchQuery("");
            setDisplayedSelectedIds([]);
          }}>
              <Rosetta.Close />
            </SubduedSimpleIconButton>
          </Dismiss>
        </div>
        <div className="Body">
          {type && <p>{t(`${type.toLowerCase()}.description`)}</p>}
          <Search placeholder={t("searchPlaceholder")} data-size={FieldSize.Medium} value={searchQuery || ""} disabled={isSharing || false} onValueChange={value => {
          // When search query changes, update the list of displayed selected IDs
          if (value !== searchQuery) {
            setDisplayedSelectedIds([...selectedUserIds]);
          }
          setSearchQuery(value);
          if (value.trim() === "") {
            setSearchQuery("");
            // Don't clear displayedSelectedIds when clearing search
            // This keeps selected users visible when search is cleared
          }
        }} className="CustomSearch" />
          {peopleSuggestionsLoading && <div>{t("loading")}</div>}
          {peopleSuggestionsError && <div>{t("peopleSearchFailed")}</div>}

          {peopleSuggestions?.mentionRecommendations?.peopleSuggestions.length === 0 && <p className="NoResultLabel">{t("noResults")}</p>}

          {/* Always show checked users at the top, regardless of search */}
          <ul disabled={isSharing || false} className="CustomList">
            {/* Show selected users at the top */}
            {displayedSelectedIds.map(id => {
            // Find user in allLoadedUsers
            const user = allLoadedUsers.find(u => u.id === id);
            return user ? <PeopleListItem key={`selected-${user.id}`} user={user as User} isChecked={selectedUserIds.includes(user.id)} selectedUserIds={selectedUserIds} setSelectedUserIds={setSelectedUserIds} /> : null;
          })}
            {/* Show users from the current search */}
            {peopleSuggestions?.mentionRecommendations?.peopleSuggestions
          // Don't show users that are already displayed at the top
          .filter(user => !displayedSelectedIds.includes(user.id)).map(user => <PeopleListItem key={user.id} user={user as User} selectedUserIds={selectedUserIds} isChecked={selectedUserIds.includes(user.id)} setSelectedUserIds={setSelectedUserIds} />)}
          </ul>
        </div>
        <div className="Footer">
          <div className="editor-wrapper" data-hook="message-editor">
            <RichTextEditor className="rich-text-editor" value={editorValue} onChange={({
            currentTarget: {
              value
            }
          }) => setEditorValue(value)} placeholder={t("conversation.message-input.placeholder")} name="message" disabled={isSharing || false} toolbar={<RTEToolbar disabled={isSharing || false} schema={[{
            type: ToolbarItem.Formatting,
            name: "styles"
          }, {
            type: ToolbarItem.Button,
            name: "actionItem",
            position: ToolbarItemPosition.Right,
            props: {
              as: PrimaryButton,
              element: <ButtonText>{t("sendButton")}</ButtonText>,
              type: "button",
              disabled: !editorValue,
              onClick: async () => handleShare()
            }
          }]} />} />
          </div>
        </div>
      </Modal>
    </DialogContext.Provider>;
};
export default ShareWindow;
