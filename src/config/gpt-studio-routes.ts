export type StudioFeatureGroup = "create" | "tools" | "assets" | "records";

export interface StudioFeatureRoute {
  id: string;
  label: string;
  route: `#${string}`;
  group: StudioFeatureGroup;
  note: string;
}

export const GPT_STUDIO_BASE_URL = "http://127.0.0.1:3600/";

export const GPT_STUDIO_FEATURE_ROUTES: StudioFeatureRoute[] = [
  {
    id: "studio",
    label: "提示词生图",
    route: "#studio",
    group: "create",
    note: "Prompt Kit / 参考图 / 实时预览"
  },
  {
    id: "style-transfer",
    label: "风格迁移",
    route: "#style-transfer",
    group: "create",
    note: "原图与风格参考图"
  },
  {
    id: "reference-analysis",
    label: "融图分析",
    route: "#reference-analysis",
    group: "create",
    note: "多参考图语义分析"
  },
  {
    id: "image-decomposition",
    label: "图片拆解",
    route: "#image-decomposition",
    group: "create",
    note: "产品结构与信息图"
  },
  {
    id: "image-edit",
    label: "图片编辑",
    route: "#image-edit",
    group: "create",
    note: "整图编辑 / 局部蒙版"
  },
  {
    id: "quick-blend",
    label: "快速融图",
    route: "#quick-blend",
    group: "create",
    note: "A/B/C/D 分组融合"
  },
  {
    id: "image-compress",
    label: "图片压缩",
    route: "#image-compress",
    group: "tools",
    note: "浏览器本地压缩转换"
  },
  {
    id: "creation",
    label: "电商套图",
    route: "#creation",
    group: "create",
    note: "类目模板 / SKU / Listing"
  },
  {
    id: "portrait",
    label: "写真模式",
    route: "#portrait",
    group: "create",
    note: "人物 / 动作 / 服装 / 地点"
  },
  {
    id: "article-illustration",
    label: "文章插图",
    route: "#article-illustration",
    group: "create",
    note: "文章包解析与插图计划"
  },
  {
    id: "ppt",
    label: "PPT 生成",
    route: "#ppt",
    group: "create",
    note: "逐页补图 / PPTX 导出"
  },
  {
    id: "gallery",
    label: "瀑布画廊",
    route: "#gallery",
    group: "assets",
    note: "多模式结果浏览"
  },
  {
    id: "article-record",
    label: "文章记录",
    route: "#article-record",
    group: "records",
    note: "失败项继续与导出"
  },
  {
    id: "creation-record",
    label: "套图记录",
    route: "#creation-record",
    group: "records",
    note: "补图 / 清单 / Listing 草稿"
  },
  {
    id: "portrait-record",
    label: "写真记录",
    route: "#portrait-record",
    group: "records",
    note: "筛选 / 查看 / 重试"
  },
  {
    id: "ppt-record",
    label: "PPT 记录",
    route: "#ppt-record",
    group: "records",
    note: "打开结果 / 下载文件"
  }
];

export const GPT_STUDIO_REQUIRED_ROUTES = GPT_STUDIO_FEATURE_ROUTES.map((feature) => feature.route);
