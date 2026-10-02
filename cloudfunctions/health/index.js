/**
 * 云函数 health —— Day 15 的第一个后端接口
 * ------------------------------------------------------------
 * 它做什么：只回一句"我活着"。**不连数据库、不读环境变量、不写任何业务逻辑。**
 *
 * 为什么第一个接口要做成这么"空"的：
 *   因为今天要验证的不是"业务能不能跑"，而是**整条链路通不通** ——
 *   代码在本地 → 能不能传上云 → 云上能不能跑起来 → 公网能不能访问到 → 返回的格式对不对。
 *   这条链路上任何一环坏掉，都会表现成"打不开"。
 *   先拿一个"没有任何依赖的接口"把链路走通，后面接数据库时，
 *   一旦出问题就能**确定不是链路的问题**，只在业务代码里找。
 *
 * ⚠️ 这个函数故意不引任何依赖：
 *   不 require('wx-server-sdk')、不 require('@cloudbase/node-sdk')。
 *   依赖越少，能出错的地方越少 —— 今天只要证明"链路通"。
 *
 * 入口约定（腾讯云 CloudBase Node.js 云函数）：
 *   导出 main，接收 (event, context)，返回一个对象。
 *   通过 HTTP 访问服务触发时，返回值会被序列化成 JSON 响应体。
 */

/**
 * @param {object} event   - 调用方传进来的参数（HTTP 触发时含 path/headers/queryStringParameters 等）
 * @param {object} context - 运行上下文（含环境信息、请求 ID 等）
 * @returns {{ok: boolean, service: string}} 固定形状的响应
 */
exports.main = async (event, context) => {
  // event 和 context 今天用不上，但**保留形参**是有意的：
  //   将来要加日志（谁调的、什么时候调的）时，它们就在这里，不用改函数签名。

  return {
    ok: true,
    service: 'solar System'
  };
};
