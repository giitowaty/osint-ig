"use strict";

// Keep the public profile and displayed media fields consumed by our analysis.
// Viewer, routing, tracking and request-token fields are deliberately omitted.
function profileFromWebGraphql(profile, edges) {
  return {
    id: String(profile.pk || profile.id), username: profile.username,
    full_name: profile.full_name, biography: profile.biography,
    external_url: profile.external_url, profile_pic_url: profile.profile_pic_url,
    profile_pic_url_hd: profile.hd_profile_pic_url_info?.url,
    is_verified: profile.is_verified, is_private: profile.is_private,
    category_name: profile.category, is_business_account: profile.is_business,
    is_professional_account: profile.is_professional_account,
    followed_by_viewer: profile.friendship_status?.following,
    edge_followed_by: { count: profile.follower_count ?? null },
    edge_follow: { count: profile.following_count ?? null },
    edge_owner_to_timeline_media: { count: profile.media_count ?? null,
      edges: edges.map(({ node }) => ({ node: {
        shortcode: node.code,
        __typename: node.media_type === 2 ? "GraphVideo" : node.media_type === 8 ? "GraphSidecar" : "GraphImage",
        is_video: node.media_type === 2,
        thumbnail_src: node.image_versions2?.candidates?.[0]?.url || node.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url || "",
        taken_at_timestamp: node.taken_at,
        video_view_count: node.view_count ?? null,
        edge_liked_by: { count: node.like_and_view_counts_disabled ? null : node.like_count ?? null },
        edge_media_to_comment: { count: node.comment_count ?? null },
        edge_media_to_caption: { edges: node.caption?.text ? [{ node: { text: node.caption.text } }] : [] },
        accessibility_caption: node.accessibility_caption,
        location: node.location?.name ? { name: node.location.name } : null,
        coauthor_producers: (node.coauthor_producers || []).map((u) => ({ username: u.username })),
        edge_media_to_tagged_user: { edges: (node.usertags?.in || []).filter((t) => t.user?.username)
          .map((t) => ({ node: { user: { username: t.user.username } } })) },
        edge_media_preview_like: { edges: (node.facepile_top_likers || []).filter((u) => u.username)
          .map((u) => ({ node: { username: u.username, full_name: u.full_name || "" } })) },
      } })),
    },
  };
}

module.exports = { profileFromWebGraphql };
