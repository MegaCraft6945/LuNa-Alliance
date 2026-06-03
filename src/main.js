import { supabase } from "./api.js";

let user = null;
let profile = null;
let isAdmin = false;
let events = [];
let forumCategories = [];
let activeForumCategory = null;
let siteSettings = {};
let settingsTimer = null;
let members = [];
let membersById = {};
let admins = [];
let myRoleApplication = null;
let editingForumPost = null;
let editingEvent = null;

const $ = (id) => document.getElementById(id);

$("loginBtn").onclick = () => login("discord");
$("googleLoginBtn").onclick = () => login("google");
$("logoutBtn").onclick = logout;
$("forumBackBtn").onclick = showForumCategories;
$("backToForumPostsBtn").onclick = showForumPostList;
$("backToEventsBtn").onclick = showEventsList;
$("cancelEditEventBtn").onclick = () => {
  $("editEventMsg").textContent = "";
  closeEventEditPage();
};
$("editCategoryBtn").onclick = showEditCategoryForm;
$("cancelEditCategoryBtn").onclick = () => {
  $("editCategoryForm").classList.remove("editing");
  $("editCategoryForm").classList.add("hidden");
  $("editForumMsg").textContent = "";
  hideForumPostForm();
};
$("deleteCategoryBtn").onclick = deleteActiveCategory;
$("showForumPostFormBtn").onclick = showForumPostForm;
$("cancelForumPostBtn").onclick = hideForumPostForm;
$("addAdminBtn").onclick = addAdminFromInput;
$("manualRoleBtn").onclick = () => setManualRole(false);
$("removeRoleBtn").onclick = () => setManualRole(true);
$("backToMembersBtn").onclick = showMembersList;
$("cancelEditPostBtn").onclick = closeForumActionPage;

document.querySelectorAll(".admin-tab").forEach(btn => {
  btn.addEventListener("click", () => showAdminTab(btn.dataset.adminTab));
});
$("backToMailBtn").onclick = showMailList;

document.querySelectorAll(".nav,.jump").forEach(btn => {
  btn.addEventListener("click", () => showPage(btn.dataset.page));
});

["discordJoinLink", "memberEmojiInput", "memberEmojiEnabledInput", "managerEmojiInput", "managerEmojiEnabledInput", "roleR1ColorInput", "roleR2ColorInput", "roleR3ColorInput", "roleR4ColorInput"].forEach(id => {
  $(id).addEventListener("input", () => {
    if (!isAdmin) return;
    clearTimeout(settingsTimer);
    $("settingsMsg").textContent = "Saving...";
    settingsTimer = setTimeout(saveSettings, 700);
  });
});

async function login(provider) {
  await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/`
    }
  });
}

async function logout() {
  await supabase.auth.signOut();
  location.reload();
}

function showPage(page) {
  if ((page === "members" || page === "admin") && !isAdmin) page = "home";

  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav").forEach(b => b.classList.remove("active"));

  $(page).classList.add("active");
  document.querySelectorAll(`[data-page="${page}"]`).forEach(b => b.classList.add("active"));

  if (page === "forum") showForumCategories();
  if (page === "admin" && isAdmin) loadRoleApplications();
  if (page === "messages" && user) loadMessages();
}

async function init() {
  const { data } = await supabase.auth.getUser();
  user = data.user;

  if (user) {
    const meta = user.user_metadata || {};
    profile = {
      id: user.id,
      name: meta.full_name || meta.name || meta.user_name || meta.preferred_username || meta.email || "User",
      avatar_url: meta.avatar_url || meta.picture || ""
    };

    await supabase.from("members").upsert({
      id: user.id,
      username: profile.name,
      avatar_url: profile.avatar_url,
      updated_at: new Date().toISOString()
    });

    const { data: adminRow } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    isAdmin = !!adminRow;
  }

  await loadSettings();
  await loadMembers();
  await loadAdmins();
  updateAuthUI();
  if (user) await loadMyRoleApplication();
  await loadEvents();
  await loadForumCategories();

  if (isAdmin) await loadRoleApplications();
  if (user) await loadMessages();
  if (user) await refreshMailBadge();

  supabase.channel("luna-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, loadEvents)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, loadEvents)
    .on("postgres_changes", { event: "*", schema: "public", table: "members" }, loadMembers)
    .on("postgres_changes", { event: "*", schema: "public", table: "admins" }, async () => { await loadAdmins(); updateAuthUI(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "site_settings" }, loadSettings)
    .on("postgres_changes", { event: "*", schema: "public", table: "forum_categories" }, loadForumCategories)
    .on("postgres_changes", { event: "*", schema: "public", table: "forum_posts" }, () => {
      if (activeForumCategory) loadForumPosts(activeForumCategory.id);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "forum_post_comments" }, () => {
      if (activeForumCategory) loadForumPosts(activeForumCategory.id);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "role_applications" }, () => {
      if (user) loadMyRoleApplication();
      if (isAdmin) loadRoleApplications();
      updateAuthUI();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "user_messages" }, async () => {
      if (user) {
        await loadMessages();
        await refreshMailBadge();
      }
    })
    .subscribe();
}

function updateAuthUI() {
  $("loginBtn").classList.toggle("hidden", !!user);
  $("googleLoginBtn").classList.toggle("hidden", !!user);
  $("logoutBtn").classList.toggle("hidden", !user);
  $("userBox").classList.toggle("hidden", !user);

  if (user) {
    const me = membersById[user.id] || {};
    $("userBox").innerHTML = `<img src="${profile.avatar_url || ""}" alt=""><span>${escapeHtml(shortName(profile.name))}</span>${roleBadge(me.role || "")}`;
  }

  document.querySelectorAll(".logged-only").forEach(el => el.classList.toggle("hidden", !user));
  if (!user) setMailCount(0);
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin));
  const me = user ? membersById[user.id] : null;
const hasRole = !!(me && me.role);
document.querySelectorAll(".role-apply-link").forEach(el => el.classList.toggle("hidden", !user || hasRole));
}


function getImages(row) {
  if (Array.isArray(row.image_urls)) return row.image_urls.filter(Boolean);
  if (row.image_urls && typeof row.image_urls === "string") {
    try {
      const parsed = JSON.parse(row.image_urls);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
  }
  return row.image_url ? [row.image_url] : [];
}

async function uploadImages(bucket, files) {
  const list = Array.from(files || []);
  const urls = [];

  for (const file of list) {
    const url = await uploadImage(bucket, file);
    if (url) urls.push(url);
  }

  return urls;
}

function fillImageRemoveSelect(selectId, images) {
  const select = $(selectId);
  if (!select) return;

  select.innerHTML = `<option value="">Replace all images if new images are chosen</option>`;

  if (images.length) {
    const allOption = document.createElement("option");
    allOption.value = "__REMOVE_ALL__";
    allOption.textContent = "Remove all images";
    select.appendChild(allOption);
  }

  images.forEach((url, index) => {
    const option = document.createElement("option");
    option.value = url;
    option.textContent = `Replace/remove Image ${index + 1}`;
    select.appendChild(option);
  });
}

function renderImagesHtml(images, className = "event-full-image") {
  if (!images.length) return "";
  return images.map((url, index) => `
    <img class="${className}" src="${escapeHtml(url)}" alt="Image ${index + 1}">
  `).join("");
}

function imageCarouselHtml(images, prefix) {
  if (!images.length) return "";

  return `
    <div class="image-carousel" data-prefix="${escapeHtml(prefix)}">
      <img class="event-full-image carousel-image" id="${prefix}CarouselImage" src="${escapeHtml(images[0])}" alt="Image 1">
      ${images.length > 1 ? `
        <div class="image-carousel-actions">
          <button class="ghost" id="${prefix}PrevImage" type="button">← Previous</button>
          <button class="ghost" id="${prefix}NextImage" type="button">Next →</button>
        </div>
      ` : ""}
    </div>
  `;
}

function setupImageCarousel(images, prefix) {
  if (!images.length) return;

  let index = 0;
  const img = $(`${prefix}CarouselImage`);
  const prev = $(`${prefix}PrevImage`);
  const next = $(`${prefix}NextImage`);

  function render() {
    if (!img) return;
    img.src = images[index];
    img.alt = `Image ${index + 1}`;
  }

  if (prev) {
    prev.onclick = () => {
      index = (index - 1 + images.length) % images.length;
      render();
    };
  }

  if (next) {
    next.onclick = () => {
      index = (index + 1) % images.length;
      render();
    };
  }

  if (img) {
    img.onclick = () => window.open(images[index], "_blank");
  }

  render();
}

function removeSelectedImage(images, selectedUrl) {
  if (!selectedUrl) return images;
  return images.filter(url => url !== selectedUrl);
}

function replaceImagesWithSelection(currentImages, selectedUrl, addedImages) {
  const images = [...(currentImages || [])];

  if (selectedUrl === "__REMOVE_ALL__") {
    return addedImages.length ? addedImages : [];
  }

  if (!addedImages.length) {
    return removeSelectedImage(images, selectedUrl);
  }

  if (selectedUrl) {
    const index = images.indexOf(selectedUrl);
    if (index >= 0) {
      images.splice(index, 1, ...addedImages);
      return images;
    }
  }

  return addedImages;
}

async function uploadImage(bucket, file) {
  if (!file) return "";
  const fileName = `${Date.now()}-${file.name.replace(/[^a-z0-9_.-]/gi, "_")}`;
  const { error } = await supabase.storage.from(bucket).upload(fileName, file);
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(fileName).data.publicUrl;
}

function setting(key, fallback = "") {
  return siteSettings[key] || fallback;
}

function shortName(name = "") {
  return String(name || "Member").split("#")[0].trim();
}

function roleColor(role) {
  return setting(`role_${String(role || "").toLowerCase()}_color`, {
    R1: "#66bbff",
    R2: "#22c55e",
    R3: "#a855f7",
    R4: "#f59e0b"
  }[role] || "#9bd8ff");
}

function roleBadge(role) {
  return role ? `<span class="role-badge" style="--role-color:${escapeHtml(roleColor(role))}">[${escapeHtml(role)}]</span>` : "";
}

function memberTypeBadge(userId) {
  const admin = admins.some(a => a.user_id === userId);
  return admin
    ? `<span class="type-badge admin-type">[Admin]</span>`
    : `<span class="type-badge member-type">[Member]</span>`;
}

function memberIcon(userId) {
  const isManager = admins.some(a => a.user_id === userId);

  if (isManager) {
    return setting("manager_emoji_enabled", "true") === "false"
      ? ""
      : setting("manager_emoji", "👑");
  }

  return setting("member_emoji_enabled", "true") === "false"
    ? ""
    : setting("member_emoji", "👤");
}

function userLine(userId, username = "Member") {
  const member = membersById[userId] || {};
  return `<span class="comment-head">${memberIcon(userId)} ${memberTypeBadge(userId)} ${roleBadge(member.role || "")}<strong>${escapeHtml(shortName(username || member.username || "Member"))}</strong></span>`;
}

function showAdminTab(tabId) {
  document.querySelectorAll(".admin-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.adminTab === tabId));
  document.querySelectorAll(".admin-section").forEach(section => section.classList.toggle("active", section.id === tabId));
}

function memberEmojiFor(userId) {
  return memberIcon(userId);
}


function memberNameLine(userId, username = "Member") {
  return userLine(userId, username);
}

async function loadSettings() {
  const { data, error } = await supabase.from("site_settings").select("*");
  if (error) {
    console.error(error);
    return;
  }

  siteSettings = {};
  (data || []).forEach(row => siteSettings[row.key] = row.value);

  const link = setting("discord_join_link", "#");
  $("discordJoinBtn").href = link;
  $("discordJoinBtn").classList.toggle("hidden", !link || link === "#");

  $("discordJoinLink").value = setting("discord_join_link", "");
  $("memberEmojiInput").value = setting("member_emoji", "👤");
  $("memberEmojiEnabledInput").checked = setting("member_emoji_enabled", "true") !== "false";
  $("managerEmojiInput").value = setting("manager_emoji", "👑");
  $("managerEmojiEnabledInput").checked = setting("manager_emoji_enabled", "true") !== "false";
  $("roleR1ColorInput").value = setting("role_r1_color", "#66bbff");
  $("roleR2ColorInput").value = setting("role_r2_color", "#22c55e");
  $("roleR3ColorInput").value = setting("role_r3_color", "#a855f7");
  $("roleR4ColorInput").value = setting("role_r4_color", "#f59e0b");
}

async function saveSettings() {
  const rows = [
    { key: "discord_join_link", value: $("discordJoinLink").value.trim(), updated_by: user.id, updated_at: new Date().toISOString() },
    { key: "member_emoji", value: $("memberEmojiInput").value.trim() || "👤", updated_by: user.id, updated_at: new Date().toISOString() },
    { key: "member_emoji_enabled", value: $("memberEmojiEnabledInput").checked ? "true" : "false", updated_by: user.id, updated_at: new Date().toISOString() },
    { key: "manager_emoji", value: $("managerEmojiInput").value.trim() || "👑", updated_by: user.id, updated_at: new Date().toISOString() },
    { key: "manager_emoji_enabled", value: $("managerEmojiEnabledInput").checked ? "true" : "false", updated_by: user.id, updated_at: new Date().toISOString() },
    { key: "role_r1_color", value: $("roleR1ColorInput").value.trim() || "#66bbff", updated_by: user.id, updated_at: new Date().toISOString() },
    { key: "role_r2_color", value: $("roleR2ColorInput").value.trim() || "#22c55e", updated_by: user.id, updated_at: new Date().toISOString() },
    { key: "role_r3_color", value: $("roleR3ColorInput").value.trim() || "#a855f7", updated_by: user.id, updated_at: new Date().toISOString() },
    { key: "role_r4_color", value: $("roleR4ColorInput").value.trim() || "#f59e0b", updated_by: user.id, updated_at: new Date().toISOString() }
  ];

  const { error } = await supabase.from("site_settings").upsert(rows);
  $("settingsMsg").textContent = error ? error.message : "Saved.";
  if (!error) await loadSettings();
}

async function loadAdmins() {
  const { data, error } = await supabase.from("admins").select("*").order("created_at", { ascending: false });
  if (error) {
    admins = [];
    if ($("adminsList")) $("adminsList").innerHTML = `<div class="mini-item">${escapeHtml(error.message)}</div>`;
    return;
  }

  admins = data || [];
  renderAdminsList();
}

function renderAdminsList() {
  if (!$("adminsList")) return;

  $("adminsList").innerHTML = "";

  admins.forEach(admin => {
    const member = membersById[admin.user_id] || {};
    const item = document.createElement("div");
    item.className = "mini-item admin-row";

    const displayName = member.username ? shortName(member.username) : admin.user_id;
    const avatar = member.avatar_url || "";

    item.innerHTML = `
      <div class="admin-info">
        ${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : `<div class="admin-avatar-fallback">?</div>`}
        <div>
          <strong>${escapeHtml(displayName)}</strong>
          <small>${escapeHtml(admin.user_id)}${admin.user_id === user?.id ? " • you" : ""}</small>
        </div>
      </div>
      <button class="danger remove-admin" type="button">Remove</button>
    `;

    item.querySelector(".remove-admin").onclick = async () => {
      if (admins.length <= 1) {
        alert("You cannot remove the only admin. Add another admin first, then you can remove this one.");
        return;
      }

      if (!confirm(admin.user_id === user?.id
        ? "Remove yourself as admin? You will lose admin access."
        : "Remove this admin?"
      )) return;

      const { error } = await supabase
        .from("admins")
        .delete()
        .eq("user_id", admin.user_id);

      if (error) {
        alert(error.message);
        return;
      }

      await loadMembers();
      await loadAdmins();

      if (admin.user_id === user?.id) {
        isAdmin = false;
        updateAuthUI();
        showPage("home");
      }
    };

    $("adminsList").appendChild(item);
  });
}

async function loadMembers() {
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  members = data || [];
  membersById = {};
  members.forEach(m => membersById[m.id] = m);

  $("memberCount").textContent = members.length;
  $("membersList").innerHTML = "";
  $("roleMemberSelect").innerHTML = `<option value="">Select member</option>`;

  members.forEach(member => {
    const isManager = admins.some(a => a.user_id === member.id);
    const card = document.createElement("div");
    card.className = "member-card";
    card.innerHTML = `
      <img src="${member.avatar_url || ""}" alt="">
      <div>
        <div class="member-line">${userLine(member.id, member.username)}</div>
        ${member.game_username ? `<p class="small">Game: ${escapeHtml(member.game_username)}</p>` : ""}
        <p class="small">Tap to view full details</p>
      </div>
    `;
    card.onclick = () => openMemberDetail(member);
    $("membersList").appendChild(card);

    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = `${member.username || "Member"} ${member.role ? `(${member.role})` : ""}`;
    $("roleMemberSelect").appendChild(option);
  });

  updateAuthUI();
}

function openMemberDetail(member) {
  const admin = admins.some(a => a.user_id === member.id);
  $("membersList").classList.add("hidden");
  $("memberDetail").classList.remove("hidden");
  $("memberDetailContent").innerHTML = `
    <div class="member-detail-card">
      <img src="${member.avatar_url || ""}" alt="">
      <h2>${escapeHtml(shortName(member.username || "Member"))}</h2>
      <p>${memberIcon(member.id)} ${admin ? "[Admin]" : "[Member]"} ${member.role ? `[${escapeHtml(member.role)}]` : "[No Role]"}</p>
      <div class="detail-grid">
        <span>Member ID</span><strong>${escapeHtml(member.id)}</strong>
        <span>Game Username</span><strong>${escapeHtml(member.game_username || "Not set")}</strong>
        <span>Alliance Rank</span><strong>${member.role ? escapeHtml(member.role) : "No role"}</strong>
        <span>Site rank</span><strong>${admin ? "Admin" : "Member"}</strong>
      </div>
    </div>
  `;
}

function showMembersList() {
  $("memberDetail").classList.add("hidden");
  $("membersList").classList.remove("hidden");
}

async function addAdminFromInput() {
  if (!isAdmin) return;

  const id = $("newAdminId").value.trim();
  if (!id) {
    $("adminAddMsg").textContent = "Paste a member user_id first.";
    return;
  }

  const { error } = await supabase.from("admins").insert({ user_id: id });
  $("adminAddMsg").textContent = error ? error.message : "Admin added.";

  if (!error) {
    $("newAdminId").value = "";
    await loadAdmins();
    await loadMembers();
  }
}

async function setManualRole(remove = false) {
  if (!isAdmin) return;

  const memberId = $("roleMemberSelect").value;
  const role = remove ? "" : $("manualRoleSelect").value;

  if (!memberId) {
    $("manualRoleMsg").textContent = "Select a member first.";
    return;
  }

  const { error } = await supabase.from("members").update({ role }).eq("id", memberId);
  $("manualRoleMsg").textContent = error ? error.message : (remove ? "Role removed." : "Role updated.");

  if (!error) await loadMembers();
}

async function loadMyRoleApplication() {
  if (!user) return;

  const { data } = await supabase
    .from("role_applications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  myRoleApplication = data || null;

  const done = $("roleApplyDone");
  const myMember = membersById[user.id] || {};
  const hasRole = !!myMember.role;

  if (hasRole) {
    done.classList.remove("hidden");
    done.innerHTML = `<h3>Role already set</h3><p>Your current alliance role is <strong>${escapeHtml(myMember.role)}</strong>.</p>`;
    $("roleApplyForm").classList.add("hidden");
  } else {
    done.classList.add("hidden");
    if (user) $("roleApplyForm").classList.remove("hidden");
  }
}

$("roleApplyForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!user) return;

  $("roleApplyMsg").textContent = "Sending...";

  const { error } = await supabase.from("role_applications").insert({
    user_id: user.id,
    username: profile.name,
    game_username: $("applyGameUsername").value.trim(),
    requested_role: $("applyRole").value,
    status: "pending"
  });

  $("roleApplyMsg").textContent = error ? error.message : "Application sent to admins.";

  if (!error) {
    $("roleApplyForm").reset();
    await loadMyRoleApplication();
    updateAuthUI();
    if (isAdmin) await loadRoleApplications();
  }
};

async function loadRoleApplications() {
  const { data, error } = await supabase
    .from("role_applications")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    $("roleApplicationsList").innerHTML = `<div class="mini-item">${escapeHtml(error.message)}</div>`;
    return;
  }

  $("roleApplicationsList").innerHTML = "";

  if (!data || !data.length) {
    $("roleApplicationsList").innerHTML = `<div class="mini-item">No pending role applications.</div>`;
    return;
  }

  data.forEach(app => {
    const div = document.createElement("div");
    div.className = "mini-item application-item";
    div.innerHTML = `
      <strong>${escapeHtml(app.username || "Member")}</strong>
      <span>Game username: ${escapeHtml(app.game_username || "")}</span>
      <span>Requested role: ${escapeHtml(app.requested_role || "")}</span>
      <span>${escapeHtml(app.user_id)}</span>
      <div class="application-actions">
        <button class="primary approve-role">Approve</button>
        <button class="danger reject-role">Reject</button>
      </div>
    `;

    div.querySelector(".approve-role").onclick = async () => approveRoleApplication(app);
    div.querySelector(".reject-role").onclick = async () => rejectRoleApplication(app.id);

    $("roleApplicationsList").appendChild(div);
  });
}

async function approveRoleApplication(app) {
  if (!isAdmin) return;

  const { error: updateError } = await supabase.from("members")
    .update({
      role: app.requested_role,
      game_username: app.game_username
    })
    .eq("id", app.user_id);

  if (updateError) {
    alert(updateError.message);
    return;
  }

  const { error } = await supabase.from("role_applications")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", app.id);

  if (error) alert(error.message);

  const mailError = await sendMessage(
    app.user_id,
    "Role approved",
    `Your ${app.requested_role} role has been approved by ${profile?.name || "Admin"}.`
  );

  if (mailError) alert(`Role approved, but mail failed: ${mailError.message}`);

  await loadMembers();
  await loadRoleApplications();
  if (user) await loadMessages();
}

async function rejectRoleApplication(id) {
  if (!isAdmin) return;

  const { error } = await supabase.from("role_applications")
    .update({
      status: "rejected",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) alert(error.message);

  await loadRoleApplications();
}


async function sendMessage(userId, title, body, imageUrl = "") {
  if (!userId) return null;
  const { error } = await supabase.from("user_messages").insert({
    user_id: userId,
    title,
    body,
    image_url: imageUrl || "",
    is_read: false
  });
  return error;
}

async function sendMessageToAll(title, body, imageUrl = "") {
  if (!members.length) await loadMembers();

  const rows = members.map(member => ({
    user_id: member.id,
    title,
    body,
    image_url: imageUrl || "",
    is_read: false
  }));

  if (!rows.length) return null;

  const { error } = await supabase.from("user_messages").insert(rows);
  return error;
}

async function loadMessages() {
  if (!user) return;

  $("messageDetail").classList.add("hidden");
  $("messagesList").classList.remove("hidden");
  $("messagesList").innerHTML = `<div class="panel">Loading mail...</div>`;

  const { data, error } = await supabase
    .from("user_messages")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    $("messagesList").innerHTML = `<div class="panel"><h3>Mail error</h3><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }

  const totalMessages = (data || []).length;
  setMailCount(totalMessages);
  $("messagesList").innerHTML = "";

  if (!data || !data.length) {
    $("messagesList").innerHTML = `<div class="panel"><h3>No messages yet.</h3><p class="small">Mail loaded correctly, but there are no messages for this logged-in user.</p></div>`;
    return;
  }

  data.forEach(message => {
    const div = document.createElement("div");
    div.className = `panel message-item ${message.is_read ? "" : "unread"}`;
    div.innerHTML = `
      <h3>${escapeHtml(message.title)}</h3>
      <p>${escapeHtml(shorten(message.body || "", 140))}</p>
      <small class="small">${new Date(message.created_at).toLocaleString()}</small>
      <div class="message-actions">
        <button class="ghost open-message">Open</button>
        ${!message.is_read ? `<button class="ghost mark-read">Mark as read</button>` : ""}
        <button class="danger delete-message">Delete</button>
      </div>
    `;

    div.querySelector(".open-message").onclick = async () => {
      await openMessage(message);
    };

    const readBtn = div.querySelector(".mark-read");
    if (readBtn) {
      readBtn.onclick = async (e) => {
        e.stopPropagation();
        await supabase.from("user_messages").update({ is_read: true }).eq("id", message.id);
        await loadMessages();
        await refreshMailBadge();
      };
    }

    div.querySelector(".delete-message").onclick = async (e) => {
      e.stopPropagation();
      await supabase.from("user_messages").delete().eq("id", message.id);
      await loadMessages();
      await refreshMailBadge();
    };

    $("messagesList").appendChild(div);
  });
}

async function openMessage(message) {
  $("messagesList").classList.add("hidden");
  $("messageDetail").classList.remove("hidden");

  if (!message.is_read) {
    await supabase.from("user_messages").update({ is_read: true }).eq("id", message.id);
    message.is_read = true;
    await refreshMailBadge();
  }

  $("messageDetailContent").innerHTML = `
    <div class="mail-full">
      <h2>${escapeHtml(message.title)}</h2>
      <small class="small">${new Date(message.created_at).toLocaleString()}</small>
      ${message.image_url ? `<img class="mail-image" src="${escapeHtml(message.image_url)}" alt="Mail image">` : ""}
      <p class="mail-body">${escapeHtml(message.body || "")}</p>
      <div class="message-actions">
        <button class="danger" id="deleteOpenMessageBtn" type="button">Delete Message</button>
      </div>
    </div>
  `;

  $("deleteOpenMessageBtn").onclick = async () => {
    await supabase.from("user_messages").delete().eq("id", message.id);
    showMailList();
    await loadMessages();
  };
}

function showMailList() {
  $("messageDetail").classList.add("hidden");
  $("messagesList").classList.remove("hidden");
}



function setMailCount(count) {
  const badge = $("mailUnreadBadge");
  const btn = $("mailNavBtn");
  const total = Number(count) || 0;

  if (badge) {
    badge.textContent = `(${total})`;
  }

  if (btn) {
    // Keep the button as exactly: Mail <span id="mailUnreadBadge">(0)</span>
    const currentBadge = $("mailUnreadBadge");
    btn.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) node.textContent = "";
    });
    if (!btn.firstChild || btn.firstChild.nodeType !== Node.TEXT_NODE) {
      btn.insertBefore(document.createTextNode("Mail "), btn.firstChild);
    } else {
      btn.firstChild.textContent = "Mail ";
    }
    if (currentBadge && currentBadge.parentNode !== btn) {
      btn.appendChild(currentBadge);
    }
  }
}

async function refreshMailBadge() {
  if (!user || !$("mailUnreadBadge")) return;

  const { data, error } = await supabase
    .from("user_messages")
    .select("id")
    .eq("user_id", user.id);

  if (error) {
    console.error(error);
    setMailCount(0);
    return;
  }

  const total = (data || []).length;
  setMailCount(total);
}


function showEventsList() {
  $("eventDetail").classList.add("hidden");
  $("eventsList").classList.remove("hidden");
}

function openEventDetail(event) {
  $("eventsList").classList.add("hidden");
  $("eventDetail").classList.remove("hidden");

  const author = membersById[event.author_id] || {};
  const authorName = author.username || event.username || "LuNa Admin";
  const authorLine = event.author_id
    ? userLine(event.author_id, authorName)
    : `<span class="comment-head"><strong>${escapeHtml(shortName(authorName))}</strong></span>`;

  $("eventDetailContent").innerHTML = `
    <div class="event-full">
      <div class="event-full-meta">
        <span class="small">Posted By</span>
        ${authorLine}
      </div>

      <h2>${escapeHtml(event.title || "Untitled Event")}</h2>

      <div>
        <h3>Event details</h3>
        <p class="event-full-body">${escapeHtml(event.content || "")}</p>
      </div>

      ${getImages(event).length ? `
        <div>
          <h3>Event images</h3>
          ${imageCarouselHtml(getImages(event), "eventDetail")}
        </div>
      ` : ""}

      <div class="detail-comments-block">
        <h3>Comments</h3>
        <div id="eventDetailComments" class="comments-list"></div>
        <form id="eventDetailCommentForm" class="comment-form ${user ? "" : "hidden"}">
          <input placeholder="Write a comment..." required />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  `;

  setupImageCarousel(getImages(event), "eventDetail");

  const detailCommentsBox = $("eventDetailComments");
  if (detailCommentsBox) {
    loadComments(event.id, detailCommentsBox);
  }

  const detailCommentForm = $("eventDetailCommentForm");
  if (detailCommentForm) {
    detailCommentForm.onsubmit = async (e) => {
      e.preventDefault();
      const input = detailCommentForm.querySelector("input");
      const content = input.value.trim();
      if (!content || !user) return;

      await supabase.from("comments").insert({
        event_id: event.id,
        user_id: user.id,
        username: profile.name,
        content
      });

      input.value = "";
      await loadComments(event.id, detailCommentsBox);
      await loadEvents();
    };
  }

  $("eventDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return console.error(error);

  events = data || [];
  $("eventCount").textContent = events.length;
  renderEvents();
}

function renderEvents() {
  $("eventsList").innerHTML = "";
  $("latestEvents").innerHTML = "";

  events.forEach(event => $("eventsList").appendChild(createEventCard(event)));
  events.forEach(event => $("latestEvents").appendChild(createLatestEventCard(event)));

  updateAuthUI();
}


function createLatestEventCard(event) {
  const card = document.createElement("article");
  card.className = "latest-update-card";

  const images = getImages(event);
  const imageWrapHtml = images.length
    ? `<div class="latest-update-image-wrap"><img class="latest-update-image" src="${escapeHtml(images[0])}" alt="Event image"></div>`
    : `<div class="latest-update-image-wrap"><div class="latest-update-placeholder">☾</div></div>`;

  card.innerHTML = `
    ${imageWrapHtml}
    <div class="latest-update-content">
      <small>${new Date(event.created_at).toLocaleString()}</small>
      <h3>${escapeHtml(event.title || "Untitled Event")}</h3>
      <p>${escapeHtml(shorten(event.content || "", 120))}</p>
      <button class="ghost latest-open-event" type="button">View Event</button>
    </div>
  `;

  card.onclick = () => {
    showPage("events");
    openEventDetail(event);
  };

  const btn = card.querySelector(".latest-open-event");
  if (btn) {
    btn.onclick = (e) => {
      e.stopPropagation();
      showPage("events");
      openEventDetail(event);
    };
  }

  return card;
}

function createEventCard(event, compact = false) {
  const node = document.getElementById("eventTemplate").content.cloneNode(true);
  const img = node.querySelector(".event-image");
  const comments = node.querySelector(".comments");
  const commentsBox = node.querySelector(".comments-list");
  const commentForm = node.querySelector(".comment-form");

  const eventImages = getImages(event);
  if (eventImages.length) {
    img.src = eventImages[0];
    img.classList.remove("hidden");
    img.onclick = () => openEventDetail(event);
  }

  const eventTitle = node.querySelector("h3");
  eventTitle.textContent = event.title || "Untitled";
  eventTitle.classList.add("clickable-title");
  eventTitle.onclick = () => openEventDetail(event);
  node.querySelector(".event-meta").textContent = new Date(event.created_at).toLocaleString();
  const eventBody = node.querySelector(".event-body");
  eventBody.textContent = compact ? shorten(event.content || "", 130) : (event.content || "");
  eventBody.onclick = () => openEventDetail(event);

  node.querySelector(".comment-toggle").onclick = () => {
    showPage("events");
    openEventDetail(event);
  };

  const editEventBtn = node.querySelector(".edit-event");
  if (editEventBtn) {
    editEventBtn.onclick = () => openEditEvent(event);
  }

  node.querySelector(".delete-event").onclick = async () => {
    if (!confirm("Delete this event?")) return;
    const imagesToDelete = getImages(event);
    await supabase.from("events").delete().eq("id", event.id);
    await deleteBucketImages(imagesToDelete);
    await loadEvents();
  };

  commentForm.onsubmit = async (e) => {
    e.preventDefault();
    const input = commentForm.querySelector("input");
    const content = input.value.trim();
    if (!content || !user) return;

    await supabase.from("comments").insert({
      event_id: event.id,
      user_id: user.id,
      username: profile.name,
      content
    });

    input.value = "";
    await loadComments(event.id, commentsBox);
  };

  loadComments(event.id, commentsBox);
  return node;
}

async function loadComments(eventId, box) {
  const { data } = await supabase
    .from("comments")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  box.innerHTML = "";

  (data || []).forEach(comment => {
    const canDelete = user && (comment.user_id === user.id || isAdmin);
    const div = document.createElement("div");
    div.className = "comment";
    div.innerHTML = `
      ${memberNameLine(comment.user_id, comment.username)}
      <p>${escapeHtml(comment.content || "")}</p>
      <small>${new Date(comment.created_at).toLocaleString()}</small>
      ${canDelete ? `<button class="danger delete-comment">Delete</button>` : ""}
    `;

    const btn = div.querySelector(".delete-comment");
    if (btn) {
      btn.onclick = async () => {
        await supabase.from("comments").delete().eq("id", comment.id);
        await loadComments(eventId, box);
      };
    }

    box.appendChild(div);
  });
}

function openEditEvent(event) {
  if (!isAdmin) return;
  editingEvent = event;

  const page = $("eventEditPage");
  const form = $("editEventForm");
  if (!page || !form) return;

  $("editEventTitle").value = event.title || "";
  $("editEventContent").value = event.content || "";
  fillImageRemoveSelect("removeEventImageSelect", getImages(event));
  $("editEventMsg").textContent = "";

  document.body.classList.add("event-edit-page-open");
  if ($("eventsList")) $("eventsList").classList.add("hidden");
  if ($("eventDetail")) $("eventDetail").classList.add("hidden");

  page.innerHTML = `
    <div class="forum-action-page panel">
      <button id="backFromEventEditBtn" class="ghost" type="button">← Back to Events</button>
      <div class="page-head"><h2>Edit Event</h2></div>
      <div id="eventEditSlot"></div>
    </div>
  `;

  page.querySelector("#eventEditSlot").appendChild(form);
  form.classList.remove("hidden");
  page.classList.remove("hidden");
  page.style.display = "block";

  page.querySelector("#backFromEventEditBtn").onclick = closeEventEditPage;
  page.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("editEventForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!editingEvent || !isAdmin) return;

  $("editEventMsg").textContent = "Saving...";

  try {
    let images = getImages(editingEvent);
    const addedImages = await uploadImages("event-images", $("editEventImage").files);
    images = replaceImagesWithSelection(images, $("removeEventImageSelect").value, addedImages);

    const { error } = await supabase.from("events")
      .update({
        title: $("editEventTitle").value.trim(),
        content: $("editEventContent").value.trim(),
        image_url: images[0] || "",
        image_urls: images
      })
      .eq("id", editingEvent.id);

    if (error) throw error;

    $("editEventMsg").textContent = "Event saved.";
    $("editEventForm").reset();
    $("editEventForm").classList.add("hidden");
    editingEvent = null;
    closeEventEditPage();
    if ($("eventDetail")) $("eventDetail").classList.add("hidden");
    if ($("eventsList")) $("eventsList").classList.remove("hidden");
    await loadEvents();
  } catch (err) {
    $("editEventMsg").textContent = err.message;
  }
};

$("eventForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!isAdmin) return;
  $("adminMsg").textContent = "Posting...";

  try {
    const imageUrls = await uploadImages("event-images", $("eventImage").files);
    const imageUrl = imageUrls[0] || "";
    const title = $("eventTitle").value.trim();
    const content = $("eventContent").value.trim();

    const { error } = await supabase.from("events").insert({
      title,
      content,
      image_url: imageUrl,
      image_urls: imageUrls,
      author_id: user.id
    });

    if (error) throw error;

    const mailError = await sendMessageToAll("New event posted", `${title}\n\n${content}`, imageUrl);

    $("eventForm").reset();
    $("adminMsg").textContent = mailError
      ? `Event posted, but mail failed: ${mailError.message}`
      : "Event posted and mail sent.";

    await loadEvents();
    if (user) await loadMessages();
  } catch (err) {
    $("adminMsg").textContent = err.message;
  }
};

async function loadForumCategories() {
  const { data, error } = await supabase
    .from("forum_categories")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return console.error(error);

  forumCategories = data || [];
  $("forumCount").textContent = forumCategories.length;
  await renderForumCategories();
}

async function countCategoryComments(categoryId) {
  const { data: posts } = await supabase.from("forum_posts").select("id").eq("category_id", categoryId);
  const ids = (posts || []).map(post => post.id);
  if (!ids.length) return 0;
  const { count } = await supabase.from("forum_post_comments").select("id", { count: "exact", head: true }).in("post_id", ids);
  return count || 0;
}

async function renderForumCategories() {
  const box = $("forumCategories");
  box.innerHTML = "";

  for (const category of forumCategories) {
    const node = document.getElementById("forumCategoryTemplate").content.cloneNode(true);
    const card = node.querySelector(".forum-card");
    const img = node.querySelector(".forum-thumb");

    node.querySelector("h3").textContent = category.title;
    node.querySelector("p").textContent = category.description || "Tap to see posts";
    node.querySelector("small").textContent = new Date(category.created_at).toLocaleString();

    const commentsCount = await countCategoryComments(category.id);

    let countBox = node.querySelector(".forum-count");
    if (!countBox) {
      countBox = document.createElement("div");
      countBox.className = "forum-count";
      node.querySelector(".forum-info").appendChild(countBox);
    }
    countBox.textContent = `💬 ${commentsCount}`;

    const categoryImages = getImages(category);
    if (categoryImages.length) {
      img.src = categoryImages[0];
      img.classList.remove("hidden");
    }

    card.onclick = () => openForumCategory(category);
    box.appendChild(node);
  }
}

function showForumPostForm() {
  if (!user || !activeForumCategory) return;

  const page = $("forumCreatePostPage");
  const form = $("forumPostForm");
  if (!page || !form) return;

  document.body.classList.add("forum-action-page-open");
  if ($("forumPostsWrap")) $("forumPostsWrap").classList.add("hidden");
  if ($("forumPostDetail")) $("forumPostDetail").classList.add("hidden");
  if ($("forumEditPostPage")) $("forumEditPostPage").classList.add("hidden");

  page.innerHTML = `
    <div class="forum-action-page panel">
      <button id="backFromCreatePostBtn" class="ghost" type="button">← Back to ${escapeHtml(activeForumCategory.title || "Category")}</button>
      <div class="page-head"><h2>Create Forum Post</h2></div>
      <div id="forumCreatePostSlot"></div>
    </div>
  `;

  page.querySelector("#forumCreatePostSlot").appendChild(form);
  form.classList.add("creating");
  form.classList.remove("hidden");
  form.style.display = "block";
  $("forumPostMsg").textContent = "";

  page.classList.remove("hidden");
  page.style.display = "block";
  page.querySelector("#backFromCreatePostBtn").onclick = closeForumActionPage;
  page.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideForumPostForm() {
  const form = $("forumPostForm");
  if (form) {
    form.classList.remove("creating");
    form.classList.add("hidden");
    form.style.display = "none";
    const wrap = $("forumPostsWrap");
    if (wrap) wrap.insertBefore(form, $("editForumPostForm"));
  }
  if ($("forumPostMsg")) $("forumPostMsg").textContent = "";
  if ($("forumCreatePostPage")) {
    $("forumCreatePostPage").classList.add("hidden");
    $("forumCreatePostPage").style.display = "none";
  }
  document.body.classList.remove("forum-action-page-open");
}

async function openForumCategory(category) {
  activeForumCategory = category;
  document.body.classList.add("forum-viewing-category");

  $("forumCategories").classList.add("hidden");
  $("forumCategories").style.display = "none";

  $("forumPostsWrap").classList.remove("hidden");
  $("forumPostsWrap").style.display = "block";

  $("forumBackWrap").classList.remove("hidden");
  $("forumBackWrap").style.display = "block";

  if ($("forumPostDetail")) $("forumPostDetail").classList.add("hidden");
  if ($("forumPosts")) $("forumPosts").classList.remove("hidden");

  $("editCategoryForm").classList.remove("editing");
  $("editCategoryForm").classList.add("hidden");
  $("editForumMsg").textContent = "";
  hideForumPostForm();

  $("forumCategoryTitle").textContent = category.title;
  $("forumCategoryDescription").textContent = category.description || "";

  updateAuthUI();
  await loadForumPosts(category.id);

  $("forumBackWrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showForumCategories() {
  activeForumCategory = null;
  document.body.classList.remove("forum-viewing-category");

  $("forumPostsWrap").classList.add("hidden");
  $("forumPostsWrap").style.display = "none";

  $("forumBackWrap").classList.add("hidden");
  $("forumBackWrap").style.display = "none";

  $("forumCategories").classList.remove("hidden");
  $("forumCategories").style.display = "";

  $("forumPosts").innerHTML = "";
  if ($("forumPostDetail")) $("forumPostDetail").classList.add("hidden");

  $("editCategoryForm").classList.remove("editing");
  $("editCategoryForm").classList.add("hidden");
  hideForumPostForm();
}

function showEditCategoryForm() {
  if (!isAdmin || !activeForumCategory) return;
  $("editForumTitle").value = activeForumCategory.title || "";
  $("editForumDescription").value = activeForumCategory.description || "";
  fillImageRemoveSelect("removeForumImageSelect", getImages(activeForumCategory));
  $("editForumMsg").textContent = "";
  $("editCategoryForm").classList.add("editing");
  $("editCategoryForm").classList.remove("hidden");
}

$("editCategoryForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!isAdmin || !activeForumCategory) return;

  $("editForumMsg").textContent = "Saving...";

  try {
    let images = getImages(activeForumCategory);
    const addedImages = await uploadImages("event-images", $("editForumImage").files);
    images = replaceImagesWithSelection(images, $("removeForumImageSelect").value, addedImages);

    const { error } = await supabase.from("forum_categories")
      .update({
        title: $("editForumTitle").value.trim(),
        description: $("editForumDescription").value.trim(),
        image_url: images[0] || "",
        image_urls: images
      })
      .eq("id", activeForumCategory.id);

    if (error) throw error;

    $("editForumMsg").textContent = "Saved.";
    $("editCategoryForm").reset();
    $("editCategoryForm").classList.remove("editing");
    $("editCategoryForm").classList.add("hidden");
    await loadForumCategories();

    const updated = forumCategories.find(item => item.id === activeForumCategory.id);
    if (updated) await openForumCategory(updated);
  } catch (err) {
    $("editForumMsg").textContent = err.message;
  }
};

async function deleteActiveCategory() {
  if (!isAdmin || !activeForumCategory) return;
  if (!confirm("Delete this forum category and all posts inside it?")) return;

  const { error } = await supabase.from("forum_categories").delete().eq("id", activeForumCategory.id);

  if (error) {
    alert(error.message);
    return;
  }

  showForumCategories();
  await loadForumCategories();
}


function showForumPostList() {
  document.body.classList.remove("forum-post-detail-open");
  document.body.classList.remove("forum-action-page-open");

  if ($("forumCreatePostPage")) $("forumCreatePostPage").classList.add("hidden");
  if ($("forumEditPostPage")) $("forumEditPostPage").classList.add("hidden");
  if ($("forumPostsWrap")) $("forumPostsWrap").classList.remove("hidden");
  if ($("forumPostDetail")) $("forumPostDetail").classList.add("hidden");
  if ($("forumPosts")) $("forumPosts").classList.remove("hidden");
  if ($("categoryAdminActions")) $("categoryAdminActions").classList.remove("hidden");
  hideForumPostForm();
  if ($("editForumPostForm")) $("editForumPostForm").classList.add("hidden");
}

function openForumPostDetail(post) {
  document.body.classList.add("forum-post-detail-open");
  document.body.classList.remove("forum-action-page-open");

  if ($("forumCreatePostPage")) $("forumCreatePostPage").classList.add("hidden");
  if ($("forumEditPostPage")) $("forumEditPostPage").classList.add("hidden");
  if ($("forumPostsWrap")) $("forumPostsWrap").classList.remove("hidden");
  if ($("forumPosts")) $("forumPosts").classList.add("hidden");
  if ($("forumPostDetail")) $("forumPostDetail").classList.remove("hidden");
  if ($("forumPostForm")) $("forumPostForm").classList.add("hidden");
  if ($("editForumPostForm")) $("editForumPostForm").classList.add("hidden");
  if ($("categoryAdminActions")) $("categoryAdminActions").classList.add("hidden");

  const posterLine = userLine(post.user_id, post.username || "Member");

  $("forumPostDetailContent").innerHTML = `
    <div class="event-full forum-post-detail-page">
      <div class="event-full-meta">
        <span class="small">Posted By</span>
        ${posterLine}
      </div>

      <h2>${escapeHtml(post.title || "Untitled Post")}</h2>

      <div>
        <h3>Post details</h3>
        <p class="event-full-body">${escapeHtml(post.message || "")}</p>
      </div>

      ${getImages(post).length ? `
        <div>
          <h3>Post images</h3>
          ${imageCarouselHtml(getImages(post), "forumPostDetail")}
        </div>
      ` : ""}

      <div class="detail-comments-block">
        <h3>Comments</h3>
        <div id="forumPostDetailComments" class="forum-comments-list"></div>
        <form id="forumPostDetailCommentForm" class="forum-comment-form ${user ? "" : "hidden"}">
          <input placeholder="Write a comment..." required />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  `;

  setupImageCarousel(getImages(post), "forumPostDetail");

  const detailCommentsBox = $("forumPostDetailComments");
  if (detailCommentsBox) {
    loadForumPostComments(post.id, detailCommentsBox);
  }

  const detailCommentForm = $("forumPostDetailCommentForm");
  if (detailCommentForm) {
    detailCommentForm.onsubmit = async (e) => {
      e.preventDefault();
      const input = detailCommentForm.querySelector("input");
      const content = input.value.trim();
      if (!content || !user) return;

      await supabase.from("forum_post_comments").insert({
        post_id: post.id,
        user_id: user.id,
        username: profile.name,
        content
      });

      input.value = "";
      await loadForumPostComments(post.id, detailCommentsBox);
      await loadForumCategories();
    };
  }

  $("forumPostDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadForumPosts(categoryId) {
  const { data, error } = await supabase
    .from("forum_posts")
    .select("*")
    .eq("category_id", categoryId)
    .order("created_at", { ascending: false });

  if (error) return console.error(error);

  $("forumPosts").innerHTML = "";
  (data || []).forEach(post => $("forumPosts").appendChild(createForumPostCard(post, categoryId)));
  updateAuthUI();
}

function createForumPostCard(post, categoryId) {
  const node = document.getElementById("forumPostTemplate").content.cloneNode(true);
  const img = node.querySelector(".event-image");
  const comments = node.querySelector(".comments");
  const commentsBox = node.querySelector(".forum-comments-list");
  const commentForm = node.querySelector(".forum-comment-form");
  const deleteBtn = node.querySelector(".delete-forum-post");
  const editBtn = node.querySelector(".edit-forum-post");

  const postImages = getImages(post);
  if (postImages.length) {
    img.src = postImages[0];
    img.classList.remove("hidden");
    img.onclick = () => openForumPostDetail(post);
  }

  const postTitle = node.querySelector("h3");
  postTitle.textContent = post.title;
  postTitle.classList.add("clickable-title");
  postTitle.onclick = () => openForumPostDetail(post);

  node.querySelector(".event-meta").innerHTML = `${memberNameLine(post.user_id, post.username)} • ${new Date(post.created_at).toLocaleString()}`;

  const postBody = node.querySelector(".event-body");
  postBody.textContent = post.message || "";
  postBody.onclick = () => openForumPostDetail(post);

  const canDelete = user && (post.user_id === user.id || isAdmin);
  const canEdit = user && (post.user_id === user.id || isAdmin);
  editBtn.classList.toggle("hidden", !canEdit);
  editBtn.onclick = () => openEditForumPost(post);
  deleteBtn.classList.toggle("hidden", !canDelete);
  deleteBtn.onclick = async () => {
    if (!confirm("Delete this forum post?")) return;
    const imagesToDelete = getImages(post);
    await supabase.from("forum_posts").delete().eq("id", post.id);
    await deleteBucketImages(imagesToDelete);
    await loadForumPosts(categoryId);
  };

  node.querySelector(".forum-comment-toggle").onclick = () => {
    openForumPostDetail(post);
  };

  commentForm.onsubmit = async (e) => {
    e.preventDefault();
    const input = commentForm.querySelector("input");
    const content = input.value.trim();
    if (!content || !user) return;

    await supabase.from("forum_post_comments").insert({
      post_id: post.id,
      user_id: user.id,
      username: profile.name,
      content
    });

    input.value = "";
    await loadForumPostComments(post.id, commentsBox);
    await loadForumCategories();
  };

  loadForumPostComments(post.id, commentsBox);
  return node;
}

async function loadForumPostComments(postId, box) {
  const { data } = await supabase
    .from("forum_post_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  box.innerHTML = "";

  (data || []).forEach(comment => {
    const canDelete = user && (comment.user_id === user.id || isAdmin);
    const div = document.createElement("div");
    div.className = "comment";
    div.innerHTML = `
      ${memberNameLine(comment.user_id, comment.username)}
      <p>${escapeHtml(comment.content || "")}</p>
      <small>${new Date(comment.created_at).toLocaleString()}</small>
      ${canDelete ? `<button class="danger delete-forum-comment">Delete</button>` : ""}
    `;

    const btn = div.querySelector(".delete-forum-comment");
    if (btn) {
      btn.onclick = async () => {
        await supabase.from("forum_post_comments").delete().eq("id", comment.id);
        await loadForumPostComments(postId, box);
        await loadForumCategories();
      };
    }

    box.appendChild(div);
  });
}

$("forumCategoryForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!isAdmin) return;

  $("forumAdminMsg").textContent = "Creating...";

  try {
    const imageUrls = await uploadImages("event-images", $("forumImage").files);
    const imageUrl = imageUrls[0] || "";
    const title = $("forumTitle").value.trim();
    const description = $("forumDescription").value.trim();

    const { error } = await supabase.from("forum_categories").insert({
      title,
      description,
      image_url: imageUrl,
      image_urls: imageUrls,
      created_by: user.id
    });

    if (error) throw error;

    const mailError = await sendMessageToAll("New forum category", `${title}\n\n${description}`, imageUrl);

    $("forumCategoryForm").reset();
    $("forumAdminMsg").textContent = mailError
      ? `Forum category created, but mail failed: ${mailError.message}`
      : "Forum category created and mail sent.";

    await loadForumCategories();
    if (user) await loadMessages();
  } catch (err) {
    $("forumAdminMsg").textContent = err.message;
  }
};

async function openEditForumPost(post) {
  try {
    const { data: latestPost, error } = await supabase
      .from("forum_posts")
      .select("*")
      .eq("id", post.id)
      .single();

    if (error) throw error;
    editingForumPost = latestPost || post;
  } catch (err) {
    console.error(err);
    editingForumPost = post;
  }

  const page = $("forumEditPostPage");
  const form = $("editForumPostForm");
  if (!page || !form) return;

  document.body.classList.add("forum-action-page-open");
  if ($("forumPostsWrap")) $("forumPostsWrap").classList.add("hidden");
  if ($("forumPostDetail")) $("forumPostDetail").classList.add("hidden");
  if ($("forumCreatePostPage")) $("forumCreatePostPage").classList.add("hidden");

  $("editPostTitle").value = editingForumPost.title || "";
  $("editPostMessage").value = editingForumPost.message || "";
  fillImageRemoveSelect("removePostImageSelect", getImages(editingForumPost));
  $("editPostMsg").textContent = "";

  page.innerHTML = `
    <div class="forum-action-page panel">
      <button id="backFromEditPostBtn" class="ghost" type="button">← Back to Post</button>
      <div class="page-head"><h2>Edit Forum Post</h2></div>
      <div id="forumEditPostSlot"></div>
    </div>
  `;

  page.querySelector("#forumEditPostSlot").appendChild(form);
  form.classList.remove("hidden");
  form.style.display = "block";
  page.classList.remove("hidden");
  page.style.display = "block";
  page.querySelector("#backFromEditPostBtn").onclick = () => {
    closeForumActionPage();
    openForumPostDetail(editingForumPost);
  };
  page.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("editForumPostForm").onsubmit = async (e) => {
  e.preventDefault();

  if (!editingForumPost || !user) return;
  if (!(editingForumPost.user_id === user.id || isAdmin)) return;

  $("editPostMsg").textContent = "Saving image changes...";

  try {
    const selectedImage = $("removePostImageSelect").value;

    const { data: latestPost, error: fetchError } = await supabase
      .from("forum_posts")
      .select("*")
      .eq("id", editingForumPost.id)
      .single();

    if (fetchError) throw fetchError;

    let images = getImages(latestPost || editingForumPost);
    const addedImages = await uploadImages("event-images", $("editPostImage").files);

    images = replaceImagesWithSelection(images, selectedImage, addedImages);

    const updateData = {
      title: $("editPostTitle").value.trim(),
      message: $("editPostMessage").value.trim(),
      image_url: images[0] || "",
      image_urls: images
    };

    const { data: updatedRows, error } = await supabase
      .from("forum_posts")
      .update(updateData)
      .eq("id", editingForumPost.id)
      .select();

    if (error) throw error;

    if (!updatedRows || !updatedRows.length) {
      throw new Error("Supabase did not update the forum post. Check the forum_posts UPDATE RLS policy.");
    }

    $("editPostMsg").textContent = `Post updated. Images now: ${images.length}.`;
    $("editForumPostForm").reset();
    $("editForumPostForm").classList.add("hidden");

    const savedPostId = editingForumPost.id;
    editingForumPost = null;
    closeForumActionPage();

    if (activeForumCategory) await loadForumPosts(activeForumCategory.id);

    const { data: savedPost } = await supabase
      .from("forum_posts")
      .select("*")
      .eq("id", savedPostId)
      .single();
    if (savedPost) openForumPostDetail(savedPost);
  } catch (err) {
    $("editPostMsg").textContent = err.message;
    alert(`Forum post update failed: ${err.message}`);
  }
};

$("forumPostForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!user || !activeForumCategory) return;

  $("forumPostMsg").textContent = "Posting...";

  try {
    const imageUrls = await uploadImages("event-images", $("postImage").files);
    const imageUrl = imageUrls[0] || "";

    const { error } = await supabase.from("forum_posts").insert({
      category_id: activeForumCategory.id,
      user_id: user.id,
      username: profile.name,
      title: $("postTitle").value.trim(),
      message: $("postMessage").value.trim(),
      image_url: imageUrl,
      image_urls: imageUrls
    });

    if (error) throw error;

    $("forumPostForm").reset();
    $("forumPostMsg").textContent = "Post created.";
    closeForumActionPage();
    await loadForumPosts(activeForumCategory.id);
    await loadForumCategories();
  } catch (err) {
    $("forumPostMsg").textContent = err.message;
  }
};

function escapeHtml(text) {
  return String(text || "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function shorten(text, length) {
  return text.length > length ? text.slice(0, length) + "..." : text;
}

init();



// ============================================================
// NEXT UPDATE — Own page actions + image bucket cleanup helpers
// ============================================================
(() => {
  const $q = (id) => document.getElementById(id);
  const qs = (sel) => document.querySelector(sel);

  function showEl(el){ if(el){ el.classList.remove("hidden"); el.style.display = ""; } }
  function hideEl(el){ if(el){ el.classList.add("hidden"); el.style.display = "none"; } }

  function safeImages(item){
    if (!item) return [];
    if (Array.isArray(item.images)) return item.images.filter(Boolean);
    if (Array.isArray(item.image_urls)) return item.image_urls.filter(Boolean);
    if (item.image_url) return [item.image_url];
    if (item.imageUrl) return [item.imageUrl];
    if (item.image) return [item.image];
    return [];
  }

  function storagePathFromPublicUrl(url){
    if (!url || typeof url !== "string") return "";
    try{
      const decoded = decodeURIComponent(url);
      const marker = "/storage/v1/object/public/event-images/";
      const idx = decoded.indexOf(marker);
      if (idx >= 0) return decoded.slice(idx + marker.length).split("?")[0];
      const marker2 = "/event-images/";
      const idx2 = decoded.indexOf(marker2);
      if (idx2 >= 0) return decoded.slice(idx2 + marker2.length).split("?")[0];
    }catch(e){}
    return "";
  }

  async function removeImagesFromBucket(images){
    try{
      if (!window.supabase) return;
      const paths = (images || []).map(storagePathFromPublicUrl).filter(Boolean);
      if (!paths.length) return;
      await window.supabase.storage.from("event-images").remove(paths);
    }catch(err){
      console.warn("Image bucket delete failed:", err);
    }
  }

  window.removeImagesFromBucket = removeImagesFromBucket;

  /* ---------- Forum action pages ---------- */
  function ensureActionPage(id, title, backText){
    const page = $q(id);
    if (!page) return null;
    page.innerHTML = `
      <div class="forum-action-page">
        <button type="button" class="ghost back-action">${backText || "← Back"}</button>
        <div class="page-head"><h2>${title}</h2></div>
        <div class="action-slot"></div>
      </div>
    `;
    page.querySelector(".back-action").onclick = () => closeForumActionPage();
    return page;
  }

  function openForumActionPage(kind){
    document.body.classList.add("forum-action-page-open");
    hideEl($q("forumCreatePostPage"));
    hideEl($q("forumEditPostPage"));

    if (kind === "create"){
      const page = ensureActionPage("forumCreatePostPage", "Create Forum Post", "← Back to Category");
      const form = $q("forumPostForm");
      if (page && form){
        page.querySelector(".action-slot").appendChild(form);
        form.classList.remove("hidden");
        form.classList.add("creating");
        form.style.display = "block";
        showEl(page);
        page.scrollIntoView({behavior:"smooth", block:"start"});
      }
    }

    if (kind === "edit"){
      const page = ensureActionPage("forumEditPostPage", "Edit Forum Post", "← Back to Post");
      const form = $q("editForumPostForm");
      if (page && form){
        page.querySelector(".action-slot").appendChild(form);
        form.classList.remove("hidden");
        form.style.display = "block";
        showEl(page);
        page.scrollIntoView({behavior:"smooth", block:"start"});
      }
    }
  }

  function closeForumActionPage(){
    document.body.classList.remove("forum-action-page-open");
    hideEl($q("forumCreatePostPage"));
    hideEl($q("forumEditPostPage"));

    const postsWrap = $q("forumPostsWrap");
    if (postsWrap) showEl(postsWrap);

    const createForm = $q("forumPostForm");
    if (createForm){
      createForm.classList.remove("creating");
      createForm.classList.add("hidden");
      createForm.style.display = "none";
      const postsWrap = $q("forumPostsWrap");
      if (postsWrap) postsWrap.appendChild(createForm);
    }

    const editForm = $q("editForumPostForm");
    if (editForm){
      editForm.classList.add("hidden");
      editForm.style.display = "none";
      const detail = $q("forumPostDetail");
      if (detail) detail.appendChild(editForm);
    }
  }

  window.openForumActionPage = openForumActionPage;
  window.closeForumActionPage = closeForumActionPage;

  // Create Post button opens its own page
  document.addEventListener("click", (e) => {
    const createBtn = e.target.closest("#showForumPostFormBtn");
    if (createBtn){
      e.preventDefault();
      e.stopPropagation();
      openForumActionPage("create");
      return;
    }

    // Edit Post buttons open edit own page
    const editPostBtn = e.target.closest(".edit-post-btn, #editForumPostBtn, button[data-action='edit-post']");
    if (editPostBtn){
      setTimeout(() => openForumActionPage("edit"), 0);
      setTimeout(() => openForumActionPage("edit"), 80);
    }
  }, true);

  // If old hideForumPostForm runs, also close action page
  const oldHideForumPostForm = window.hideForumPostForm;
  if (typeof oldHideForumPostForm === "function" && !oldHideForumPostForm.__ownPageWrapped){
    const wrapped = function(...args){
      const r = oldHideForumPostForm.apply(this,args);
      const createPage = $q("forumCreatePostPage");
      if (createPage && !createPage.classList.contains("hidden")) closeForumActionPage();
      return r;
    };
    wrapped.__ownPageWrapped = true;
    window.hideForumPostForm = wrapped;
  }

  /* ---------- Event edit page ---------- */
  function openEventEditActionPage(){
    const eventForm = $q("eventForm");
    const page = $q("eventEditPage");
    if (!eventForm || !page) return;

    document.body.classList.add("event-edit-page-open");
    page.innerHTML = `
      <div class="forum-action-page">
        <button type="button" class="ghost back-action">← Back to Event</button>
        <div class="page-head"><h2>Edit Event</h2></div>
        <div class="action-slot"></div>
      </div>
    `;
    page.querySelector(".back-action").onclick = closeEventEditActionPage;
    page.querySelector(".action-slot").appendChild(eventForm);
    eventForm.classList.remove("hidden");
    eventForm.style.display = "block";
    showEl(page);
    page.scrollIntoView({behavior:"smooth", block:"start"});
  }

  function closeEventEditActionPage(){
    document.body.classList.remove("event-edit-page-open");
    const page = $q("eventEditPage");
    hideEl(page);
    const eventForm = $q("eventForm");
    const adminEvents = $q("adminEvents") || qs("#admin .admin-section") || qs("#events");
    if (eventForm && adminEvents) adminEvents.appendChild(eventForm);
  }

  window.openEventEditActionPage = openEventEditActionPage;
  window.closeEventEditActionPage = closeEventEditActionPage;

  document.addEventListener("click", (e) => {
    const editEventBtn = e.target.closest("#editEventBtn, .edit-event-btn, button[data-action='edit-event']");
    if (editEventBtn){
      setTimeout(openEventEditActionPage, 0);
      setTimeout(openEventEditActionPage, 80);
    }
  }, true);

  /* ---------- Bucket cleanup wrappers ---------- */
  async function findForumPostById(id){
    if (Array.isArray(window.forumPosts)) return window.forumPosts.find(p => String(p.id) === String(id));
    if (Array.isArray(window.posts)) return window.posts.find(p => String(p.id) === String(id));
    return null;
  }

  async function findEventById(id){
    if (Array.isArray(window.events)) return window.events.find(ev => String(ev.id) === String(id));
    if (Array.isArray(window.allEvents)) return window.allEvents.find(ev => String(ev.id) === String(id));
    return null;
  }

  // Wrap delete forum post if global function exists.
  const oldDeleteForumPost = window.deleteForumPost;
  if (typeof oldDeleteForumPost === "function" && !oldDeleteForumPost.__bucketWrapped){
    const wrapped = async function(id, ...args){
      const post = await findForumPostById(id);
      const images = safeImages(post);
      const result = await oldDeleteForumPost.call(this, id, ...args);
      await removeImagesFromBucket(images);
      return result;
    };
    wrapped.__bucketWrapped = true;
    window.deleteForumPost = wrapped;
  }

  // Wrap delete event if global function exists.
  const oldDeleteEvent = window.deleteEvent;
  if (typeof oldDeleteEvent === "function" && !oldDeleteEvent.__bucketWrapped){
    const wrapped = async function(id, ...args){
      const ev = await findEventById(id);
      const images = safeImages(ev);
      const result = await oldDeleteEvent.call(this, id, ...args);
      await removeImagesFromBucket(images);
      return result;
    };
    wrapped.__bucketWrapped = true;
    window.deleteEvent = wrapped;
  }
})();
