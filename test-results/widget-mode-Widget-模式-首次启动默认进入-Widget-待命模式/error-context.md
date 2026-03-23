# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - img [ref=e7]
      - generic [ref=e9]: 我的任务
    - generic [ref=e10]:
      - button "每日反思" [ref=e11] [cursor=pointer]:
        - img [ref=e12]
      - button "设置" [ref=e15] [cursor=pointer]:
        - img [ref=e16]
      - button "最小化" [ref=e20] [cursor=pointer]:
        - img [ref=e21]
      - button "收起为桌面小组件" [ref=e22] [cursor=pointer]:
        - img [ref=e23]
      - button "退出应用" [ref=e25] [cursor=pointer]:
        - img [ref=e26]
  - generic [ref=e29]:
    - generic [ref=e30]:
      - generic [ref=e31]:
        - button "前一天" [ref=e32] [cursor=pointer]:
          - img [ref=e33]
        - button "3月22日 · 周日" [ref=e35] [cursor=pointer]:
          - text: 3月22日 · 周日
          - img [ref=e36]
        - button [disabled] [ref=e38]:
          - img [ref=e39]
      - paragraph [ref=e42]: 🌇 下午好，还有几件事可以搞定
    - generic [ref=e43]:
      - paragraph [ref=e44]: 开始输入你的第一个任务吧
      - paragraph [ref=e45]: 按 Enter 添加 · 按 Tab 创建子任务
    - generic [ref=e46]:
      - textbox "输入第一个任务…" [ref=e48]
      - paragraph [ref=e49]: Enter 添加
  - status [ref=e51]
```